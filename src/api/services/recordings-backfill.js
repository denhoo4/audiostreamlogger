/**
 * One-time startup backfill reconcile — FEAT-001.
 *
 * The api owns the schema and opens the DB first, so it runs the one-time scan
 * that reconciles the on-disk audio tree into the recordings table
 * (design_decisions.backfill_owner). Guarded by the caller so a scan error only
 * logs and never blocks startup.
 *
 * The reconcile DIFF itself lives in the shared pure planner
 * ./reconcile-planner (reconcilePlan(existingRows, scannedFiles, options) ->
 * { inserts, removes, updates }), which is the single implementation reused by
 * the worker's reconcile job (FEAT-002). runBackfill(db, audioDir) does the fs
 * scan, loads the existing rows, computes the actively-recorded currentStamp,
 * calls the planner, and applies ONLY plan.inserts via upsertRecording.
 *
 * STARTUP STAYS INSERT-ONLY (unchanged behaviour): the backfill deliberately
 * ignores plan.removes and plan.updates. It only adds rows for on-disk slots the
 * table does not yet know about; it never deletes or restatuses existing rows at
 * boot. The full two-way sync (removes + updates) is the worker reconcile job's
 * job, not the startup path. reconcilePlan is re-exported here for backward
 * compatibility with callers/tests that import it from this module.
 */
const fs = require('fs');
const path = require('path');
const { parseRecordingFilename } = require('../lib/recording-name');
const { reconcilePlan } = require('./reconcile-planner');
const { upsertRecording } = require('./recordings');

const AUDIO_BASE_DIR = path.join(__dirname, '../audio');

/**
 * Current date-time in local 'YYYY-MM-DD-HH' format, matching the recorder's
 * on-disk filename stamp and the peakfilegenerator's currentHourStamp, so the
 * actively-recorded hour is guarded by the planner (never removed/restatused).
 */
function currentHourStamp(now) {
    return (
        `${now.getFullYear()}-` +
        `${String(now.getMonth() + 1).padStart(2, '0')}-` +
        `${String(now.getDate()).padStart(2, '0')}-` +
        `${String(now.getHours()).padStart(2, '0')}`
    );
}

/**
 * Scan audio/<folder>/ two levels deep, parse each recording filename, and
 * upsert the reconciled slots that are not already in the table. A folder with
 * no readable entries is skipped. Returns the number of slots upserted.
 */
function runBackfill(db, audioDir = AUDIO_BASE_DIR) {
    let folders;
    try {
        folders = fs
            .readdirSync(audioDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
    } catch (err) {
        if (err.code === 'ENOENT') {
            return 0; // no audio tree yet (fresh deploy) — nothing to reconcile
        }
        throw err;
    }

    const scanned = [];
    for (const folder of folders) {
        const folderPath = path.join(audioDir, folder);
        let files;
        try {
            files = fs.readdirSync(folderPath);
        } catch {
            continue; // unreadable folder — skip, do not fail the whole scan
        }
        for (const name of files) {
            const parsed = parseRecordingFilename(name);
            if (!parsed) {
                continue;
            }
            scanned.push({
                folder: parsed.folder,
                date: parsed.date,
                hour: parsed.hour,
                part: parsed.part,
                file_path: path.join(folderPath, name),
            });
        }
    }

    const existingRows = db
        .prepare(
            'SELECT stream_folder, date, hour, status, segment_count, file_path FROM recordings'
        )
        .all();

    const plan = reconcilePlan(existingRows, scanned, {
        currentStamp: currentHourStamp(new Date()),
    });

    // Startup is INSERT-ONLY: apply inserts, ignore removes/updates (see header).
    for (const rec of plan.inserts) {
        upsertRecording(db, rec);
    }
    return plan.inserts.length;
}

module.exports = { reconcilePlan, runBackfill, currentHourStamp, AUDIO_BASE_DIR };
