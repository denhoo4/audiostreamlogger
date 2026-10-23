/**
 * One-time startup backfill reconcile — FEAT-001.
 *
 * The api owns the schema and opens the DB first, so it runs the one-time scan
 * that reconciles the on-disk audio tree into the recordings table
 * (design_decisions.backfill_owner). Guarded by the caller so a scan error only
 * logs and never blocks startup.
 *
 * reconcilePlan(existingKeySet, scannedFiles) is PURE (no fs/DB): given the set
 * of 'folder|date|hour' keys already present and a list of parsed scanned files,
 * it returns the hour-slots that need an upsert, each with a derived status and
 * segment_count. runBackfill(db, audioDir) does the fs scan + applies the plan.
 */
const fs = require('fs');
const path = require('path');
const { parseRecordingFilename } = require('../lib/recording-name');
const { upsertRecording } = require('./recordings');

const AUDIO_BASE_DIR = path.join(__dirname, '../audio');

/**
 * Pure reconcile: fold parsed scanned files into one planned upsert per
 * (folder, date, hour) slot NOT already in `existingKeySet`.
 *
 * `scannedFiles` entries are { folder, date, hour, part, file_path } (part 1 is
 * the primary file, 2+ a .partN segment). A slot with any .partN segment is
 * 'partial' (a mid-hour restart happened); a lone primary is 'complete'.
 * segment_count is the number of distinct files folded into the slot. file_path
 * is the primary file when present, else the lowest-part segment seen.
 *
 * Returns an array of { stream_folder, date, hour, file_path, status,
 * segment_count } ready to pass to upsertRecording. Idempotent: re-running over
 * the same scanned set with the produced keys already in `existingKeySet` yields
 * an empty plan.
 */
function reconcilePlan(existingKeySet, scannedFiles) {
    const existing = existingKeySet || new Set();
    const slots = new Map();

    for (const file of scannedFiles || []) {
        const key = `${file.folder}|${file.date}|${file.hour}`;
        if (existing.has(key)) {
            continue; // already reconciled — skip so the plan stays idempotent
        }

        let slot = slots.get(key);
        if (!slot) {
            slot = {
                stream_folder: file.folder,
                date: file.date,
                hour: file.hour,
                file_path: file.file_path,
                _primaryPath: null,
                _minPart: file.part,
                segment_count: 0,
                _hasSegment: false,
            };
            slots.set(key, slot);
        }

        slot.segment_count += 1;
        if (file.part === 1) {
            slot._primaryPath = file.file_path;
        } else {
            slot._hasSegment = true;
        }
        if (file.part < slot._minPart) {
            slot._minPart = file.part;
            if (file.part !== 1) {
                slot.file_path = file.file_path;
            }
        }
    }

    return Array.from(slots.values()).map((slot) => ({
        stream_folder: slot.stream_folder,
        date: slot.date,
        hour: slot.hour,
        file_path: slot._primaryPath || slot.file_path,
        status: slot._hasSegment ? 'partial' : 'complete',
        segment_count: slot.segment_count,
    }));
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

    const existing = new Set(
        db
            .prepare('SELECT stream_folder, date, hour FROM recordings')
            .all()
            .map((r) => `${r.stream_folder}|${r.date}|${r.hour}`)
    );

    const plan = reconcilePlan(existing, scanned);
    for (const rec of plan) {
        upsertRecording(db, rec);
    }
    return plan.length;
}

module.exports = { reconcilePlan, runBackfill, AUDIO_BASE_DIR };
