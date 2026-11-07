/**
 * One-off AAC duration backfill (FEAT-001).
 *
 * Regression 1 left existing .aac recordings rows with a wrong duration_seconds:
 * a raw ADTS .aac has no container duration, so the old `ffprobe format=duration`
 * probe overshot ~16x for 44.1 kHz AAC (and some rows were never filled at all,
 * so duration_seconds is NULL). The worker's live path is fixed by measuring the
 * AAC frame count; this standalone backfill corrects the ROWS ALREADY ON DISK
 * that were written with the bad figure.
 *
 * It is a deliberate, idempotent ONE-OFF — NOT a scheduled job. It walks the
 * audio tree exactly like peakfilegenerator (two-level readdir, skipping any
 * dotfile/dot-directory via isIgnoredEntry so the recorder's `.inprogress`/
 * `.live` work dirs are never touched), and for each .aac file whose recordings
 * row has a NULL or implausible (> MAX_PLAUSIBLE_SECONDS) duration_seconds it
 * re-measures with the frame-count probe and corrects the row via
 * upsertRecordingMeta. Rows that already look plausible are left untouched, so a
 * second run writes nothing. mp3/opus/flac rows are never considered.
 *
 * The frame-count measurement is delegated to peakfilegenerator's overridable
 * probeDurationSeconds export, so a test can stub the probe without a real
 * ffprobe binary.
 */
const fs = require('fs');
const path = require('path');
const { isIgnoredEntry, parseRecordingParts } = require('../filename-utils');
const { splitStamp, upsertRecordingMeta } = require('../recordings-db');
const peakfilegenerator = require('./peakfilegenerator');
const { AUDIO_DIR } = require('./paths');

// A finalised hour is ~3600 s. Anything above this ceiling is the ~16x ADTS
// overshoot (or otherwise corrupt) and must be re-measured; NULL is likewise
// treated as needing a measurement. Rows at or below this are left untouched so
// the backfill is idempotent.
const MAX_PLAUSIBLE_SECONDS = 4000;

/**
 * True when an existing duration_seconds value must be re-measured: it is NULL/
 * undefined (never filled) or implausibly large (the ~16x ADTS overshoot).
 */
function needsBackfill(durationSeconds) {
    return (
        durationSeconds === null ||
        durationSeconds === undefined ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds > MAX_PLAUSIBLE_SECONDS
    );
}

/**
 * Re-measure every existing .aac recording whose duration_seconds is wrong and
 * correct its row. Returns a summary object { scanned, corrected, skipped,
 * errors } for the caller to log. A per-file probe/DB failure is counted and
 * never aborts the walk; a top-level AUDIO_DIR read failure throws.
 */
function runAacDurationBackfill(db) {
    const counters = { scanned: 0, corrected: 0, skipped: 0, errors: 0 };

    const topEntries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
    topEntries
        .filter((dirent) => dirent.isDirectory())
        // Never descend into any dotfile dir (.inprogress / .live), exactly like
        // every other audio-tree walk.
        .filter((dirent) => !isIgnoredEntry(dirent.name))
        .forEach((dirent) => {
            const folder = dirent.name;
            const outputFolder = path.join(AUDIO_DIR, folder);

            fs.readdirSync(outputFolder)
                .filter((file) => !isIgnoredEntry(file))
                .filter((file) => path.extname(file) === '.aac')
                .forEach((file) => {
                    counters.scanned += 1;

                    const parts = parseRecordingParts(file);
                    if (parts === null) {
                        return;
                    }
                    const split = splitStamp(parts.stamp);
                    if (split === null) {
                        return;
                    }

                    try {
                        const row = db
                            .prepare(
                                'SELECT duration_seconds FROM recordings WHERE stream_folder = ? AND date = ? AND hour = ?'
                            )
                            .get(folder, split.date, split.hour);

                        // No row yet OR an existing plausible row: leave it. A
                        // missing row is owned by the recorder/peakgen, not this
                        // one-off correction; re-measuring would race them.
                        if (row === undefined || !needsBackfill(row.duration_seconds)) {
                            counters.skipped += 1;
                            return;
                        }

                        const aacPath = path.join(outputFolder, file);
                        const durationSeconds = peakfilegenerator.probeDurationSeconds(
                            aacPath,
                            '.aac'
                        );
                        const sizeBytes = fs.statSync(aacPath).size;
                        upsertRecordingMeta(db, {
                            folder,
                            stamp: parts.stamp,
                            durationSeconds,
                            sizeBytes,
                            part: parts.part,
                            ext: 'aac',
                        });
                        counters.corrected += 1;
                    } catch {
                        counters.errors += 1;
                    }
                });
        });

    return counters;
}

module.exports = { runAacDurationBackfill, needsBackfill, MAX_PLAUSIBLE_SECONDS };

// CLI guard: run the backfill ONCE when invoked directly (`node
// handlers/aac-duration-backfill.js`), opening the worker's own RW handle. This
// is deliberately NOT wired into the scheduled job runner — it is a manual
// correction tool. Requiring the module (tests, other code) never runs it.
if (require.main === module) {
    const { openDb } = require('../db');
    const db = openDb();
    try {
        const summary = runAacDurationBackfill(db);
        // eslint-disable-next-line no-console
        console.log(
            `AAC duration backfill done: ${summary.scanned} .aac file(s) scanned, ` +
                `${summary.corrected} row(s) corrected, ${summary.skipped} already plausible, ` +
                `${summary.errors} error(s).`
        );
    } finally {
        db.close();
    }
}
