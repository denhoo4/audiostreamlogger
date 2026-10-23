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
 */
const fs = require('fs');
const path = require('path');
const { validateRetentionHours } = require('../settings-utils');
const { AUDIO_DIR } = require('./paths');

const DEFAULT_RETENTION_HOURS = 2;

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
function deleteOldFiles(dir, thresholdTime, log, counters) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const filePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            try {
                deleteOldFiles(filePath, thresholdTime, log, counters);
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
                }
            } catch (err) {
                log.push(`Error processing file ${filePath}: ${err.message}`);
                counters.errors += 1;
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
    // Recompute the threshold on every run so the cutoff stays relative to "now".
    const thresholdTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    log.push(
        `Cleaner run at ${new Date().toISOString()}: deleting files older than ${hours} hour(s) under ${AUDIO_DIR}.`
    );

    const counters = { deleted: 0, errors: 0 };
    // A top-level unreadable audio dir throws -> the job fails.
    deleteOldFiles(AUDIO_DIR, thresholdTime, log, counters);

    log.push(
        `Cleaner done: ${counters.deleted} file(s) deleted, ${counters.errors} per-file error(s).`
    );
    return log.join('\n');
}

module.exports = { runCleaner };
