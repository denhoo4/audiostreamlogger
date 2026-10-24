// Pure, side-effect-free folder-validation helpers for the recorder.
// Kept in a separate module (mirroring backoff-helpers.js / catchup-helpers.js)
// so tests can require them without triggering recorder.js's boot side effects
// (DB read, cron register, signal handlers). No fs I/O, no DB.
//
// Defense-in-depth: the recorder interpolates each stream's DB `folder` into a
// filesystem path. These guards ensure a malformed/hostile folder is rejected
// before it ever reaches mkdirSync/ffmpeg/existsSync.

const path = require('path');

// Deliberate per-service COPY of FOLDER_RE from src/api/lib/validate-stream.js:28.
// The recorder image only COPYs src/recorder/, so it CANNOT require src/api;
// the allowlist is duplicated on purpose rather than cross-required. Keep this
// in sync with the api write-path validator (^[a-z0-9_-]+$, lowercase-only).
const FOLDER_RE = /^[a-z0-9_-]+$/;

// True only for a non-empty string matching the strict lowercase allowlist.
// Rejects uppercase, empty, non-string, path separators and dot segments.
function isValidFolder(folder) {
    return typeof folder === 'string' && FOLDER_RE.test(folder);
}

// True only when resolving `folder` under `baseDir` stays strictly inside
// baseDir (i.e. the resolved path begins with path.resolve(baseDir) + path.sep).
// Guards against '..' traversal and absolute paths even if FOLDER_RE ever
// loosens. Pure path math — no filesystem access.
function isContainedPath(baseDir, folder) {
    if (typeof baseDir !== 'string' || typeof folder !== 'string') {
        return false;
    }
    const base = path.resolve(baseDir);
    const resolved = path.resolve(base, folder);
    return resolved.startsWith(base + path.sep);
}

module.exports = { isValidFolder, isContainedPath };
