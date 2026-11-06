/**
 * In-progress capture work-dir + sidecar helpers (Phases 1+2 — FEAT-002).
 *
 * Capture no longer writes the primary `<folder>-<stamp>.<ext>` directly. Each
 * hour's fragments are written to a HIDDEN per-hour work dir
 *   audio/<folder>/.inprogress/<stamp>/
 * as offset-named fragments `<startOffset>-<attempt>.<ext>`, with a single
 * atomic per-hour `state.json` sidecar describing what has been captured so the
 * idempotent finalise can tile the fragments onto the 3600s timeline later
 * (buildTimeline/finalizeHour, FEAT-001). The `.inprogress` dir is a dotfile so
 * it is excluded from every audio-tree walk (reconcile/peakgen/cleaner/backfill).
 *
 * The path/name builders here are PURE (no fs): they only compose strings, so
 * they unit-test in isolation (mirrors time-helpers.js / backoff-helpers.js).
 * readState/writeState are the only impure surface — writeState is ATOMIC
 * (temp file + fs.renameSync) so a crash mid-write never leaves a half-written
 * sidecar, and readState returns null for a missing/garbage sidecar so callers
 * treat "no usable state" the same as "no sidecar".
 *
 * Sidecar shape (design §3.4):
 *   {
 *     folder,            // stream folder name
 *     stamp,             // 'YYYY-MM-DD-HH'
 *     ext,               // resolved codec extension (mp3/opus/flac/aac)
 *     copyEligible,      // bool — source matched configured codec + copy container
 *     fragments: [       // ordered by append; buildTimeline re-sorts by offset
 *       { file, startOffset, plannedDuration, attempt, status, actualDuration? }
 *     ]
 *   }
 * `status` is 'open' while ffmpeg is still writing a fragment and 'closed' once
 * it ends/errors (with actualDuration set from the observed capture length).
 */
const fs = require('fs');
const path = require('path');

// The hidden work-dir name lives under each stream folder. A single constant so
// the dotfile-exclusion walks (isIgnoredEntry) and the path builder agree.
const INPROGRESS_DIR = '.inprogress';

// Sidecar filename inside the per-hour work dir.
const STATE_FILE = 'state.json';

/**
 * Absolute (or audioBase-relative) path to the per-hour work dir:
 *   <audioBase>/<folder>/.inprogress/<stamp>
 * PURE string composition — does NOT create the directory.
 */
function inprogressDir(audioBase, folder, stamp) {
    return path.join(audioBase, folder, INPROGRESS_DIR, stamp);
}

/**
 * Offset-named fragment filename `<startOffset>-<attempt>.<ext>`. The leading
 * startOffset (whole seconds from the top of the hour) is what buildTimeline
 * tiles on; the attempt disambiguates two fragments that happen to start at the
 * same offset. Non-finite/negative inputs clamp to 0 so a bad caller can never
 * produce a path-traversal or NaN name.
 */
function fragmentName(startOffset, attempt, ext = 'mp3') {
    const off = Number.isFinite(startOffset) && startOffset > 0 ? Math.floor(startOffset) : 0;
    const att = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
    return `${off}-${att}.${ext}`;
}

/**
 * Read + parse the sidecar at `<dir>/state.json`. Returns the parsed object, or
 * null for a missing file / unreadable dir / unparseable JSON (callers treat a
 * null state the same as "no in-progress work"). Never throws.
 */
function readState(dir) {
    try {
        const raw = fs.readFileSync(path.join(dir, STATE_FILE), 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        if (!Array.isArray(parsed.fragments)) {
            parsed.fragments = [];
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Atomically write the sidecar to `<dir>/state.json`: write a temp file in the
 * same dir then fs.renameSync over the target (rename is atomic within a
 * filesystem), so a reader never observes a half-written sidecar and a crash
 * mid-write leaves the previous good state intact. Assumes `dir` already exists
 * (callers mkdirSync it before the first write).
 */
function writeState(dir, state) {
    const target = path.join(dir, STATE_FILE);
    // A per-write-unique temp name in the SAME dir keeps the rename atomic
    // (cross-dir renames are not guaranteed atomic) and avoids two concurrent
    // writers clobbering each other's temp file.
    const tmp = path.join(dir, `.state.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, target);
}

module.exports = {
    INPROGRESS_DIR,
    STATE_FILE,
    inprogressDir,
    fragmentName,
    readState,
    writeState,
};
