/**
 * Cleaner job handler (ported from src/cleaner/deletefiles.js, FR-2.6 + MEDIUM-2).
 *
 * Reads `log_retention` from app_config via the passed-in RW handle, validates it
 * with validateRetentionHours (1..8760), and THROWS on out-of-bounds so the job
 * becomes `failed` (no process.exit — the worker survives multiple jobs). The
 * threshold is recomputed relative to "now" each run. Files older than the
 * threshold under AUDIO_DIR are deleted with SYNCHRONOUS fs so the handler can
 * return a complete summary and a definite success/failure. A per-file delete
 * error is logged into the output buffer but does not fail the job; a top-level
 * unreadable-dir error throws -> failed.
 *
 * FEAT-003: when an unlinked file parses as a recording (parseRecordingParts),
 * its matching (stream_folder,date,hour) recordings row is deleted so the row
 * goes away with the file. The folder is the immediate parent directory name
 * under AUDIO_DIR. A row-delete failure is logged + counted, never fatal.
 */
const fs = require('fs');
const path = require('path');
const { validateRetentionHours } = require('../settings-utils');
const { parseRecordingParts, isIgnoredEntry } = require('../filename-utils');
const { deleteRecordingByFile } = require('../recordings-db');
const { AUDIO_DIR } = require('./paths');

const DEFAULT_RETENTION_HOURS = 2;

// The recorder's hidden per-hour work dir name (mirrors
// src/recorder/inprogress.js INPROGRESS_DIR). The cleaner never descends into it
// for file retention, but it DOES age out orphaned work dirs (see below).
const INPROGRESS_DIR = '.inprogress';
// The recorder's hidden per-stream live-preview dir name (mirrors
// src/recorder/live-preview.js LIVE_DIR). It holds a single non-canonical
// elapsed-length preview per current hour, `.live/<stamp>.<ext>`. deleteOldFiles
// never descends into it (dotfile), so the cleaner's ONLY touch of it is the
// stale-preview age-out below.
const LIVE_DIR = '.live';
// A never-finalised `.inprogress/<stamp>` dir this many hours past its own hour
// is orphaned (the recorder crashed mid-hour and never came back to finalise it);
// the cleaner removes it so it does not linger. Comfortably clear of the current
// hour + the finalise cron backstop so a still-active hour is never touched.
const INPROGRESS_ORPHAN_HOURS = 2;

/**
 * Read log_retention from app_config, falling back to 2 if unset. Validates the
 * resolved value and throws on out-of-bounds.
 */
function resolveRetentionHours(db) {
    const row = db
        .prepare("SELECT value FROM app_config WHERE key='log_retention'")
        .get();
    const hours =
        row === undefined ? DEFAULT_RETENTION_HOURS : parseInt(row.value, 10);
    const check = validateRetentionHours(hours);
    if (!check.ok) {
        throw new Error(check.message);
    }
    return hours;
}

/**
 * Recursively delete files older than `thresholdTime` under `dir` using
 * synchronous fs. Per-file errors are pushed into `log`; a readdir failure on a
 * subdirectory is pushed and that subtree is skipped. A failure to read the
 * top-level dir is surfaced to the caller (throws -> failed) by the caller
 * invoking this on AUDIO_DIR without a guard.
 */
function deleteOldFiles(db, dir, thresholdTime, log, counters) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        // Never descend into or stat a dotfile entry, which includes the
        // recorder's hidden `.inprogress` work dir (FEAT-002): finalise owns
        // those fragments, the cleaner must not touch them.
        if (isIgnoredEntry(entry.name)) {
            continue;
        }
        const filePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            try {
                deleteOldFiles(db, filePath, thresholdTime, log, counters);
            } catch (err) {
                log.push(`Error reading directory ${filePath}: ${err.message}`);
            }
        } else {
            try {
                const stats = fs.statSync(filePath);
                if (stats.mtime < thresholdTime) {
                    fs.unlinkSync(filePath);
                    log.push(`Deleting: ${filePath}`);
                    counters.deleted += 1;
                    removeRecordingRow(db, dir, entry.name, log, counters);
                }
            } catch (err) {
                log.push(`Error processing file ${filePath}: ${err.message}`);
                counters.errors += 1;
            }
        }
    }
}

/**
 * After a recording mp3 is unlinked, delete its matching recordings row so the
 * row goes away with the file. The folder is the immediate parent directory
 * name under AUDIO_DIR; the stamp comes from parseRecordingParts. A non-recording
 * filename is a no-op. A row-delete failure is logged + counted, never fatal.
 */
function removeRecordingRow(db, dir, fileName, log, counters) {
    const parts = parseRecordingParts(fileName);
    if (parts === null) {
        return;
    }
    const folder = path.basename(dir);
    try {
        const removed = deleteRecordingByFile(db, { folder, stamp: parts.stamp });
        if (removed > 0) {
            counters.rowsRemoved += removed;
        }
    } catch (err) {
        log.push(
            `Error removing recordings row for ${path.join(dir, fileName)}: ${err.message}`
        );
        counters.rowErrors += 1;
    }
}

/**
 * Parse a `YYYY-MM-DD-HH` work-dir stamp into the epoch ms of the START of that
 * local hour, or null when the name is not a valid stamp. Mirrors the recorder's
 * local-time hour stamp (time-helpers.currentHourStamp); `new Date(y, m-1, d, h)`
 * interprets the parts in the host's local time, matching how the stamp was
 * minted, so no UTC/offset drift creeps into the age comparison.
 */
function parseStampStartMs(stamp) {
    const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})$/.exec(String(stamp));
    if (!m) {
        return null;
    }
    const [, y, mo, d, h] = m.map(Number);
    const dt = new Date(y, mo - 1, d, h, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

/**
 * Age out orphaned recorder work dirs: for each stream folder, remove any
 * `audio/<folder>/.inprogress/<stamp>` whose hour is more than
 * INPROGRESS_ORPHAN_HOURS past "now" (a never-finalised dir left by a crash/
 * update mid-hour). A recent/current dir is LEFT UNTOUCHED (finalise owns its
 * in-flight fragments). Per-dir failure is logged + counted, never fatal; an
 * unreadable `.inprogress` parent is skipped. The file-retention pass never
 * descends into `.inprogress` (dotfile), so this is the ONLY cleaner path that
 * touches it.
 */
function removeOrphanInprogressDirs(audioDir, log, counters, nowMs) {
    const cutoffMs = nowMs - INPROGRESS_ORPHAN_HOURS * 60 * 60 * 1000;
    let folders;
    try {
        folders = fs.readdirSync(audioDir, { withFileTypes: true });
    } catch (err) {
        log.push(`Error reading audio dir ${audioDir} for .inprogress cleanup: ${err.message}`);
        return;
    }
    for (const folder of folders) {
        if (!folder.isDirectory() || isIgnoredEntry(folder.name)) {
            continue;
        }
        const inprogressBase = path.join(audioDir, folder.name, INPROGRESS_DIR);
        let stamps;
        try {
            if (!fs.existsSync(inprogressBase)) {
                continue;
            }
            stamps = fs.readdirSync(inprogressBase, { withFileTypes: true });
        } catch (err) {
            log.push(`Error reading ${inprogressBase}: ${err.message}`);
            counters.inprogressErrors += 1;
            continue;
        }
        for (const stampEntry of stamps) {
            if (!stampEntry.isDirectory()) {
                continue;
            }
            const startMs = parseStampStartMs(stampEntry.name);
            // Unparseable name -> leave it alone (don't guess); a dir whose hour
            // start is still within the orphan window stays (may finalise soon).
            if (startMs === null || startMs > cutoffMs) {
                continue;
            }
            const dir = path.join(inprogressBase, stampEntry.name);
            try {
                fs.rmSync(dir, { recursive: true, force: true });
                log.push(`Removing orphaned work dir: ${dir}`);
                counters.inprogressRemoved += 1;
            } catch (err) {
                log.push(`Error removing orphaned work dir ${dir}: ${err.message}`);
                counters.inprogressErrors += 1;
            }
        }
    }
}

/**
 * Age out stale recorder live-preview files (FEAT-002): for each stream folder,
 * remove any `audio/<folder>/.live/<stamp>.<ext>` whose hour is more than
 * INPROGRESS_ORPHAN_HOURS past "now" — a preview the recorder stopped refreshing
 * because the hour rolled over and its canonical primary has long been written.
 * The CURRENT/recent hour's preview is LEFT UNTOUCHED (the recorder is still
 * refreshing it and the player loads it). A `.live` filename that is not a
 * `<stamp>.<ext>` preview is left alone (don't guess). Per-file failure is
 * logged + counted, never fatal; an unreadable `.live` parent is skipped. The
 * file-retention pass never descends into `.live` (dotfile), so this is the ONLY
 * cleaner path that touches it.
 */
function removeStaleLiveFiles(audioDir, log, counters, nowMs) {
    const cutoffMs = nowMs - INPROGRESS_ORPHAN_HOURS * 60 * 60 * 1000;
    let folders;
    try {
        folders = fs.readdirSync(audioDir, { withFileTypes: true });
    } catch (err) {
        log.push(`Error reading audio dir ${audioDir} for .live cleanup: ${err.message}`);
        return;
    }
    for (const folder of folders) {
        if (!folder.isDirectory() || isIgnoredEntry(folder.name)) {
            continue;
        }
        const liveBase = path.join(audioDir, folder.name, LIVE_DIR);
        let entries;
        try {
            if (!fs.existsSync(liveBase)) {
                continue;
            }
            entries = fs.readdirSync(liveBase, { withFileTypes: true });
        } catch (err) {
            log.push(`Error reading ${liveBase}: ${err.message}`);
            counters.liveErrors += 1;
            continue;
        }
        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }
            // A preview file is `<stamp>.<ext>` (stamp = YYYY-MM-DD-HH). Parse
            // the stamp portion; anything that is not a stamped preview is left
            // alone rather than guessed.
            const m = /^(\d{4}-\d{2}-\d{2}-\d{2})\.(?:mp3|opus|aac|flac)$/.exec(entry.name);
            if (!m) {
                continue;
            }
            const startMs = parseStampStartMs(m[1]);
            // Unparseable / still within the orphan window (current or recent
            // hour, still being refreshed) -> leave it.
            if (startMs === null || startMs > cutoffMs) {
                continue;
            }
            const filePath = path.join(liveBase, entry.name);
            try {
                fs.rmSync(filePath, { force: true });
                log.push(`Removing stale live preview: ${filePath}`);
                counters.liveRemoved += 1;
            } catch (err) {
                log.push(`Error removing stale live preview ${filePath}: ${err.message}`);
                counters.liveErrors += 1;
            }
        }
    }
}

/**
 * Run the cleaner once. Returns a summary string on success; throws on an
 * out-of-bounds retention value or a top-level unreadable audio dir (-> failed).
 */
function runCleaner(db) {
    const log = [];
    const hours = resolveRetentionHours(db);
    const now = Date.now();
    // Recompute the threshold on every run so the cutoff stays relative to "now".
    const thresholdTime = new Date(now - hours * 60 * 60 * 1000);
    log.push(
        `Cleaner run at ${new Date().toISOString()}: deleting files older than ${hours} hour(s) under ${AUDIO_DIR}.`
    );

    const counters = {
        deleted: 0,
        errors: 0,
        rowsRemoved: 0,
        rowErrors: 0,
        inprogressRemoved: 0,
        inprogressErrors: 0,
        liveRemoved: 0,
        liveErrors: 0,
    };
    // A top-level unreadable audio dir throws -> the job fails.
    deleteOldFiles(db, AUDIO_DIR, thresholdTime, log, counters);
    // Age out never-finalised recorder work dirs (FEAT-004). Non-fatal.
    removeOrphanInprogressDirs(AUDIO_DIR, log, counters, now);
    // Age out stale recorder live-preview files (FEAT-002). Non-fatal.
    removeStaleLiveFiles(AUDIO_DIR, log, counters, now);

    log.push(
        `Cleaner done: ${counters.deleted} file(s) deleted, ${counters.errors} per-file error(s); ${counters.rowsRemoved} recordings row(s) removed, ${counters.rowErrors} row error(s); ${counters.inprogressRemoved} orphaned work dir(s) removed, ${counters.inprogressErrors} work-dir error(s); ${counters.liveRemoved} stale live preview(s) removed, ${counters.liveErrors} live error(s).`
    );
    return log.join('\n');
}

module.exports = { runCleaner };
