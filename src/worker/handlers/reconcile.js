/**
 * Reconcile job handler (FEAT-002).
 *
 * Full two-way sync of the `recordings` table against the on-disk audio tree.
 * It scans AUDIO_DIR with the same faithful two-level directory walk the cleaner
 * and peakfilegenerator use (readdirSync(AUDIO_DIR) -> directories ->
 * readdirSync(subdir) -> allowlisted audio ext), parses each filename with
 * parseRecordingParts,
 * and splits its 'YYYY-MM-DD-HH' stamp into date/hour (splitStamp) to build the
 * planner's scannedFiles { folder, date, hour, part, file_path }. The existing
 * rows come from a SELECT over the worker RW handle; currentStamp is the local
 * hour slot (same formatting as peakfilegenerator.currentHourStamp) so the
 * actively-recorded hour is guarded by the planner (never removed/restatused).
 *
 * The diff itself is the shared pure planner (../reconcile-planner, a byte-for-
 * byte copy of the api's src/api/services/reconcile-planner.js) returning
 * { inserts, removes, updates }. Unlike the api's startup backfill (insert-only)
 * the worker applies ALL THREE directions via the row-write helpers in
 * ../recordings-db, each wrapped in withBusyRetry. A per-slot DB error is logged
 * + counted and NEVER fails the job; a top-level unreadable AUDIO_DIR throws ->
 * the job becomes `failed` (like the cleaner). Returns a summary string whose
 * final line reports added/removed/fixed counts for the SSE job viewer.
 */
const fs = require('fs');
const path = require('path');
const { parseRecordingParts } = require('../filename-utils');
const { splitStamp, upsertRecordingRow, updateRecordingRow, deleteRecordingBySlot } =
    require('../recordings-db');
const { reconcilePlan } = require('../reconcile-planner');
const { AUDIO_DIR } = require('./paths');

// Allowlisted recording extensions the scan picks up (FEAT-002). Same set as
// the peakfilegenerator; the scanned entry's file_path carries the true name so
// parseRecordingParts returns its ext and the planner is extension-agnostic.
const AUDIO_EXTS = new Set(['.mp3', '.opus', '.flac', '.aac']);

/**
 * Current date-time in local 'YYYY-MM-DD-HH' format, matching the recorder's
 * on-disk filename stamp and peakfilegenerator.currentHourStamp, so the
 * actively-recorded hour is guarded by the planner.
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
 * Two-level walk of AUDIO_DIR building the planner's scannedFiles. A top-level
 * read failure throws -> the job fails; a per-folder read failure is logged and
 * that folder skipped; a filename with no date pattern is skipped (logged).
 */
function scanAudioTree(log) {
    const scanned = [];
    const topEntries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
    topEntries
        .filter((dirent) => dirent.isDirectory())
        .forEach((dirent) => {
            const folder = dirent.name;
            const folderPath = path.join(AUDIO_DIR, folder);

            let files;
            try {
                files = fs.readdirSync(folderPath);
            } catch (err) {
                log.push(`Error reading directory ${folderPath}: ${err.message}`);
                return;
            }

            files
                .filter((file) => AUDIO_EXTS.has(path.extname(file)))
                .forEach((file) => {
                    const parts = parseRecordingParts(file);
                    if (parts === null) {
                        log.push(`Skipping file with no recording pattern: ${file}`);
                        return;
                    }
                    const split = splitStamp(parts.stamp);
                    if (split === null) {
                        log.push(`Skipping file with malformed stamp: ${file}`);
                        return;
                    }
                    scanned.push({
                        folder,
                        date: split.date,
                        hour: split.hour,
                        part: parts.part,
                        file_path: path.join(folderPath, file),
                    });
                });
        });
    return scanned;
}

/**
 * Run the reconcile once. Returns a summary string on success; a top-level
 * unreadable AUDIO_DIR throws -> failed.
 */
function runReconcile(db) {
    const log = [];
    log.push(
        `Reconcile run at ${new Date().toISOString()}: full two-way sync of recordings against ${AUDIO_DIR}.`
    );

    // A top-level unreadable audio dir throws -> the job fails.
    const scanned = scanAudioTree(log);

    const existingRows = db
        .prepare(
            'SELECT stream_folder, date, hour, status, segment_count, file_path FROM recordings'
        )
        .all();

    const plan = reconcilePlan(existingRows, scanned, {
        currentStamp: currentHourStamp(new Date()),
    });

    const counters = { added: 0, removed: 0, fixed: 0, errors: 0 };

    for (const rec of plan.inserts) {
        try {
            upsertRecordingRow(db, rec);
            counters.added += 1;
        } catch (err) {
            log.push(
                `Error inserting row for ${rec.stream_folder}/${rec.date}-${rec.hour}: ${err.message}`
            );
            counters.errors += 1;
        }
    }

    for (const rec of plan.updates) {
        try {
            updateRecordingRow(db, rec);
            counters.fixed += 1;
        } catch (err) {
            log.push(
                `Error fixing row for ${rec.stream_folder}/${rec.date}-${rec.hour}: ${err.message}`
            );
            counters.errors += 1;
        }
    }

    for (const rec of plan.removes) {
        try {
            deleteRecordingBySlot(db, rec);
            counters.removed += 1;
        } catch (err) {
            log.push(
                `Error removing row for ${rec.stream_folder}/${rec.date}-${rec.hour}: ${err.message}`
            );
            counters.errors += 1;
        }
    }

    log.push(
        `Reconcile done: ${counters.added} added, ${counters.removed} removed, ${counters.fixed} fixed (${counters.errors} per-slot error(s)).`
    );
    return log.join('\n');
}

module.exports = { runReconcile, currentHourStamp };
