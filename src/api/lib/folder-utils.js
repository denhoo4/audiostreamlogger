/**
 * Pure folder-validation + path-containment helpers for the api service.
 *
 * Deliberate per-service COPY of src/recorder/folder-utils.js (same contract,
 * same FOLDER_RE): the api image only COPYs src/api/, so it CANNOT require
 * src/recorder; the guard is duplicated on purpose rather than cross-required.
 * Keep this in sync with the recorder copy and with the api write-path
 * validator (src/api/lib/validate-stream.js FOLDER_RE, ^[a-z0-9_-]+$).
 *
 * These guards back the stream-folder lifecycle fs ops (delete/rename — TODO
 * items 25/26): every rm/rename interpolates a DB `folder` into a filesystem
 * path under the audio base dir, so a malformed/hostile folder is rejected
 * (isValidFolder) and every resolved path is proven to stay strictly inside the
 * base dir (isContainedPath) before any fs call. No fs I/O, no DB.
 */
const path = require('path');

// The lowercase allowlist shared with the recorder + the api write validator.
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

module.exports = { isValidFolder, isContainedPath, FOLDER_RE };
