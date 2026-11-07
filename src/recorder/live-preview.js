/**
 * Live current-hour PREVIEW writer (FEAT-002, Option A).
 *
 * Regression 2: the current/in-progress hour was unplayable because the only
 * playable file (the canonical primary) is written once, at the hour boundary,
 * by finalizeIfNeeded. This module produces a NON-CANONICAL, ELAPSED-length
 * preview of the current hour so the player has something to load mid-hour,
 * WITHOUT touching the canonical finalise path.
 *
 * The preview is written to a hidden per-stream dir that mirrors the
 * `.inprogress` layout:
 *   audio/<folder>/.live/<stamp>.<ext>
 * The name `<stamp>.<ext>` is DELIBERATELY DISTINCT from the canonical primary
 * `<folder>-<stamp>.<ext>` so it can NEVER satisfy finalizeIfNeeded's
 * `fs.existsSync(primaryPath)` idempotency guard — the two coexist and the
 * canonical one-3600s-primary-per-(stream,hour) invariant is unaffected. The
 * `.live` dir is a dotfile so every consumer audio-tree walk already skips it
 * (isIgnoredEntry), exactly like `.inprogress`.
 *
 * writeLivePreview reuses buildTimeline + finalizeHour, but passes
 * `hourSeconds = elapsedThisHour()` (NOT a 3600s pad), so the preview is only
 * as long as what has actually been captured so far this hour. It is
 * BEST-EFFORT: every error is logged and swallowed — a failing preview must
 * never disturb capture or the canonical finalise.
 *
 * The fs surface is kept thin and the dependencies are injected (deps) so the
 * unit test can drive it with fakes and assert the exact finalizeHour call +
 * the atomic temp-write-then-rename into `.live/<stamp>.<ext>` without spawning
 * ffmpeg or touching a real disk.
 */
const fsDefault = require('fs');
const path = require('path');
const logDefault = require('./log');
const { inprogressDir, readState: readStateDefault } = require('./inprogress');
const { buildTimeline: buildTimelineDefault } = require('./finalize-timeline');
const { finalizeHour: finalizeHourDefault } = require('./finalize-hour');
const { resolveEncoding } = require('./encoding');
const { elapsedThisHour } = require('./time-helpers');

// The hidden per-stream preview dir name (sibling of `.inprogress`). A dotfile
// so it is excluded from every audio-tree walk exactly like `.inprogress`.
const LIVE_DIR = '.live';

/**
 * Absolute path to a stream's `.live` dir: `<audioBase>/<folder>/.live`.
 * PURE string composition — does not create the directory.
 */
function liveDir(audioBase, folder) {
    return path.join(audioBase, folder, LIVE_DIR);
}

/**
 * The preview file name for an hour stamp: `<stamp>.<ext>`. DISTINCT from the
 * canonical primary `<folder>-<stamp>.<ext>` on purpose (see module header).
 */
function livePreviewName(stamp, ext) {
    return `${stamp}.${ext}`;
}

/**
 * Write (or refresh) the current-hour live preview for one stream.
 *
 * Reads the current-hour `.inprogress/<stamp>/state.json` sidecar; with no
 * sidecar or no usable fragments it is a no-op. Otherwise it lays the captured
 * fragments on a timeline whose total length is the seconds ELAPSED so far this
 * hour (so the preview matches what exists on disk, not a 3600s pad), runs
 * finalizeHour to a TEMP name inside `.live/`, then atomically renames it onto
 * `.live/<stamp>.<ext>`. It NEVER writes the canonical `<folder>-<stamp>.<ext>`.
 *
 * @param {string} audioBase  the on-disk audio root (recorder AUDIO_BASE).
 * @param {string} folder     the stream folder name.
 * @param {string} stamp      the current hour stamp `YYYY-MM-DD-HH`.
 * @param {object} enc        resolved encoding (encoding.resolveEncoding).
 * @param {object} [deps]     injectable seams for testing.
 * @returns {Promise<{written:boolean, reason?:string, previewPath?:string}>}
 */
async function writeLivePreview(audioBase, folder, stamp, enc, deps = {}) {
    const fs = deps.fs || fsDefault;
    const log = deps.log || logDefault;
    const readState = deps.readState || readStateDefault;
    const buildTimeline = deps.buildTimeline || buildTimelineDefault;
    const finalizeHour = deps.finalizeHour || finalizeHourDefault;
    const now = deps.now instanceof Date ? deps.now : new Date();

    try {
        const workDir = inprogressDir(audioBase, folder, stamp);
        const state = readState(workDir);
        if (!state || !Array.isArray(state.fragments) || state.fragments.length === 0) {
            // Nothing captured yet this hour — nothing to preview.
            return { written: false, reason: 'no-sidecar' };
        }

        // Resolve a fully-populated encoding so finalizeHour's builders always
        // have a real bitrate/sample-rate (mirrors finalizeIfNeeded). The
        // recorder tick already passes resolveEncoding(item); the fallback keeps
        // a null/partial enc from producing a `-b:a undefinedk` ffmpeg command.
        const resolvedEnc =
            enc && typeof enc.codec === 'string' && Number.isFinite(enc.bitrate_kbps)
                ? enc
                : resolveEncoding(enc || { codec: state.ext });
        const ext = state.ext || resolvedEnc.ext;

        // ELAPSED length, NOT a 3600s pad: the preview is only as long as what
        // has actually been captured so far this hour.
        const elapsed = elapsedThisHour(now);
        if (!Number.isFinite(elapsed) || elapsed <= 0) {
            // At the exact top of the hour there is nothing to show yet.
            return { written: false, reason: 'no-elapsed' };
        }

        const segments = buildTimeline(state.fragments, elapsed);

        const previewDir = liveDir(audioBase, folder);
        fs.mkdirSync(previewDir, { recursive: true });

        const previewName = livePreviewName(stamp, ext);
        const previewPath = path.join(previewDir, previewName);
        // Temp name in the SAME dir keeps the rename atomic; a reader never sees
        // a half-written preview and a crash mid-write leaves the previous good
        // preview intact.
        const tmpName = `.live-tmp.${process.pid}.${Date.now()}.${ext}`;
        const tmpPath = path.join(previewDir, tmpName);

        // finalizeHour runs ffmpeg with cwd = workDir so the sidecar's
        // offset-named fragment paths resolve, writing the hour to tmpPath with
        // hourSeconds = elapsed (the ELAPSED-length preview, not a 3600s pad).
        await finalizeHour(workDir, tmpPath, resolvedEnc, {
            segments,
            hourSeconds: elapsed,
        });

        // Atomic publish into the stable preview name.
        fs.renameSync(tmpPath, previewPath);

        return { written: true, previewPath };
    } catch (err) {
        // Best-effort: a preview failure must never disturb capture or the
        // canonical finalise. Log a greppable line and swallow.
        const detail = err instanceof Error ? err.message : String(err);
        log.error(`recorder: live preview failed for ${folder} ${stamp}:`, detail);
        return { written: false, reason: 'error' };
    }
}

module.exports = {
    LIVE_DIR,
    liveDir,
    livePreviewName,
    writeLivePreview,
};
