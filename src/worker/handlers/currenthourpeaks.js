/**
 * Current-hour peak regenerator (TODO item 24 backend, FEAT-001).
 *
 * The existing peakfilegenerator handler deliberately SKIPS the current hour
 * (that file is still being recorded) and that skip stays. This handler is the
 * complement: it rebuilds ONLY the PRIMARY current-hour peak <base>.json for
 * each known stream folder, on a short cadence, so the frontend can draw a
 * waveform for the hour that is still in progress.
 *
 * It is driven by an INDEPENDENT setInterval in worker.js (mirroring the
 * heartbeat timer), NOT the single-job busy-lock poll loop, so it never blocks
 * scheduled cleaner/peakfilegenerator/reconcile jobs.
 *
 * audiowaveform cannot append, so the regen is a full rebuild that OVERWRITES
 * any existing json. Only the primary file is handled; `.partN` segments are
 * ignored entirely (documented out-of-scope follow-up). A per-folder failure
 * (missing file / audiowaveform error) is caught, logged and counted — NEVER
 * thrown — mirroring peakfilegenerator's per-file handling.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const log = require('../log');
const { audiowaveformArgs } = require('./exec-args');
const { currentHourStamp } = require('./peakfilegenerator');
const { AUDIO_DIR } = require('./paths');

/**
 * Regenerate the primary current-hour peak json for every known stream folder.
 *
 * @param {object} db   worker RW handle (node:sqlite DatabaseSync).
 * @param {object} [opts]
 * @param {Date}   [opts.now]  clock source (injectable for tests).
 * @param {(audioPath: string, jsonPath: string) => void} [opts.run]
 *        audiowaveform runner (injectable for tests); defaults to
 *        execFileSync('audiowaveform', audiowaveformArgs(...)).
 * @returns {string} a short summary line.
 */
function regenerateCurrentHourPeaks(db, { now = new Date(), run = defaultRun } = {}) {
    const stamp = currentHourStamp(now);
    const streams = db.prepare('SELECT folder, codec FROM streams').all();

    const counters = { regenerated: 0, skipped: 0, errors: 0 };

    for (const stream of streams) {
        const folder = stream.folder;
        // ext === codec per FEAT-002; default to mp3 when unset.
        const ext = stream.codec || 'mp3';
        const outputFolder = path.join(AUDIO_DIR, folder);
        const audioPath = path.join(outputFolder, `${folder}-${stamp}.${ext}`);
        const jsonPath = path.join(outputFolder, `${folder}-${stamp}.json`);

        try {
            // Primary current-hour file only; .partN is ignored entirely.
            if (!fs.existsSync(audioPath)) {
                counters.skipped += 1;
                continue;
            }
            // Full rebuild, overwriting any existing json (audiowaveform cannot
            // append).
            run(audioPath, jsonPath);
            counters.regenerated += 1;
        } catch (error) {
            log.error(
                `currenthourpeaks: failed to regenerate ${jsonPath}: ${error.message}`
            );
            counters.errors += 1;
        }
    }

    return (
        `Current-hour peaks (${stamp}): ` +
        `${counters.regenerated} regenerated, ${counters.skipped} skipped (no current-hour file), ` +
        `${counters.errors} error(s).`
    );
}

/** Default audiowaveform runner (no shell; argv array only). */
function defaultRun(audioPath, jsonPath) {
    execFileSync('audiowaveform', audiowaveformArgs(audioPath, jsonPath));
}

module.exports = { regenerateCurrentHourPeaks };
