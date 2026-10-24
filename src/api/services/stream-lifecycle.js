/**
 * Stream-folder lifecycle service — TODO items 25 (DELETE) + 26 (RENAME).
 *
 * EXECUTION MODEL: API-DIRECT HYBRID. The api performs the DB row changes
 * transactionally AND the filesystem rm/rename over its read-write ./audio
 * mount. There is NO new worker job type, NO new jobs.type value, NO schema
 * change and NO payload channel — all of this work lives in src/api.
 *
 * Every fs op is bounded by two guards before it runs:
 *   1. isValidFolder(folder)       — the ^[a-z0-9_-]+$ allowlist (new/renamed
 *                                    folders and the old folder being operated on).
 *   2. isContainedPath(base, folder) — the resolved path must stay strictly
 *                                    inside the audio base dir, so an op can
 *                                    never escape it even if the allowlist loosened.
 * The base dir is audioBaseDir() === `process.env.AUDIO_DIR || '/usr/src/app/audio'`,
 * the SAME expression the worker's reconcile scan uses to build every
 * recordings.file_path — see lib/audio-dir.js for why that identity matters.
 *
 * fs + db are injected (defaulting to the real node:fs and the api db handle) so
 * the temp-DB + temp-dir tests drive the real logic without touching production
 * volumes, and a crash can be simulated by throwing from an injected fs op.
 */
const realFs = require('fs');
const path = require('path');
const dbHandle = require('../db');
const { audioBaseDir } = require('../lib/audio-dir');
const { isValidFolder, isContainedPath } = require('../lib/folder-utils');
const { parseRecordingFilename } = require('../lib/recording-name');
const { amsterdamSlot } = require('../lib/amsterdam-slot');

/** A rename was asked for a new folder that fails validation / collides. */
class RenameValidationError extends Error {
    constructor(message, field = 'folder') {
        super(message);
        this.name = 'RenameValidationError';
        this.field = field;
    }
}

/** The stream is recording the CURRENT hour-slot right now — op refused (409). */
class StreamRecordingNowError extends Error {
    constructor(message = 'stream is recording right now, try again next hour') {
        super(message);
        this.name = 'StreamRecordingNowError';
    }
}

/** A guard (allowlist / containment) rejected a folder path — never escapes base. */
class UnsafeFolderError extends Error {
    constructor(message = 'unsafe folder path') {
        super(message);
        this.name = 'UnsafeFolderError';
    }
}

/**
 * Resolve the absolute on-disk directory for a folder, proving it is both a
 * valid allowlisted folder AND contained under the audio base dir. Throws
 * UnsafeFolderError otherwise — the caller never reaches an fs op with an
 * unsafe path.
 */
function safeFolderPath(folder) {
    const base = audioBaseDir();
    if (!isValidFolder(folder) || !isContainedPath(base, folder)) {
        throw new UnsafeFolderError(`unsafe folder: ${folder}`);
    }
    return path.join(base, folder);
}

/**
 * Is `stream` (by its folder) recording the CURRENT Amsterdam-local hour-slot
 * RIGHT NOW? Concrete current-slot predicate (NOT a tautology over history): a
 * recordings row for THIS stream_folder whose (date, hour) equals the current
 * Europe/Amsterdam slot AND status = 'recording'. A purely historical row —
 * any other slot, or a finalized current-slot row — does NOT count. The current
 * slot is computed via the shared amsterdamSlot helper (DST-correct), injected
 * `now` defaulting to the real clock.
 */
function isRecordingNow(db, folder, now = new Date()) {
    const slot = amsterdamSlot(now);
    const row = db
        .prepare(
            `SELECT 1 FROM recordings
             WHERE stream_folder = ? AND date = ? AND hour = ? AND status = 'recording'
             LIMIT 1`
        )
        .get(folder, slot.date, slot.hour);
    return row !== undefined;
}

/**
 * ADVISORY deletion-impact snapshot for a stream's on-disk folder: the file
 * count + summed byte size under audio/<folder>/. Advisory only — the real gate
 * is the typed-folder confirmation in the UI; this just tells the admin how much
 * they are about to destroy. A missing folder reports zeros (nothing on disk).
 * Returns { folder, fileCount, totalBytes }.
 */
function deletionImpact(folder, { fs = realFs } = {}) {
    const folderPath = safeFolderPath(folder);
    let entries;
    try {
        entries = fs.readdirSync(folderPath, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') {
            return { folder, fileCount: 0, totalBytes: 0 };
        }
        throw err;
    }

    let fileCount = 0;
    let totalBytes = 0;
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        fileCount += 1;
        try {
            totalBytes += fs.statSync(path.join(folderPath, entry.name)).size;
        } catch {
            // A file vanishing mid-scan is advisory-only; skip it.
        }
    }
    return { folder, fileCount, totalBytes };
}

/**
 * DELETE a stream: remove its recordings rows AND the on-disk audio/<folder>/
 * dir AND the streams row.
 *
 * ORDERING (HARD REQUIREMENT): the DB rows (recordings + the streams row) are
 * removed TRANSACTIONALLY FIRST, and ONLY THEN is the folder rm'd from disk.
 *
 *   Rationale — fs-first is unsafe. The live recorder re-reads the stream list
 *   every ~30s; if the folder were deleted while the streams row still existed,
 *   the recorder could resurrect the folder by starting a new recording into it
 *   within that window. Removing the streams row FIRST closes that window: once
 *   the row is gone the recorder will never record into the folder again, so the
 *   subsequent rm cannot be undone by a resurrection.
 *
 *   If fs.rm fails AFTER the rows are gone, we log it and carry on: the stream
 *   is already logically deleted, and the worker reconcile / a retry can clean
 *   the orphaned dir later. We do NOT roll back the row deletion (that would
 *   reopen the resurrection window).
 *
 * Refuses with StreamRecordingNowError (-> 409) when the stream is recording the
 * current hour-slot right now (see isRecordingNow). Returns
 * { removed:true, folder, fsError:null|string }, or null when the id is unknown.
 */
function deleteStreamWithFolder(id, { fs = realFs, db = dbHandle, now = new Date() } = {}) {
    const stream = db
        .prepare('SELECT id, folder FROM streams WHERE id = ?')
        .get(id);
    if (!stream) {
        return null;
    }

    const folder = stream.folder;
    // Prove the path is safe BEFORE we touch any row, so a bad folder is a clean
    // refusal rather than a half-done delete.
    const folderPath = safeFolderPath(folder);

    if (isRecordingNow(db, folder, now)) {
        throw new StreamRecordingNowError();
    }

    // STEP 1 — rows first, transactionally. recordings rows key on stream_folder
    // (not a FK), so they are deleted explicitly alongside the streams row.
    db.exec('BEGIN');
    try {
        db.prepare('DELETE FROM recordings WHERE stream_folder = ?').run(folder);
        db.prepare('DELETE FROM streams WHERE id = ?').run(id);
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }

    // STEP 2 — folder rm SECOND. The stream is already logically gone; an rm
    // failure here leaves only an orphaned dir (reconcile/retry cleans it).
    let fsError = null;
    try {
        fs.rmSync(folderPath, { recursive: true, force: true });
    } catch (err) {
        fsError = err.message;
        // eslint-disable-next-line no-console
        console.error(
            `DELETE stream ${id}: rows removed but folder rm failed for ${folderPath} ` +
                `(stream is logically deleted; reconcile/retry can clean the orphaned dir): ${err.message}`
        );
    }

    return { removed: true, folder, fsError };
}

/**
 * Rebuild one recordings row's file_path for a folder rename, STAMP-ANCHORED.
 *
 * A blind SQL REPLACE(old,new) corrupts the YYYY-MM-DD-HH stamp for NUMERIC
 * folder names (the live stream list HAS numeric folders: 100nl, z100, m2o) —
 * e.g. renaming `100nl` would also rewrite the `100` inside a date. Instead we
 * PARSE the on-disk name with parseRecordingFilename (boundary-safe: the date
 * stamp is matched structurally, never by substring) and rebuild the canonical
 * name `<newFolder>-<date>-<hour>[.part<N>].<ext>` — identical to the recorder's
 * segmentOutputName — then join it under the new folder with the SAME base dir
 * the reconcile scan uses, so the rebuilt absolute path matches byte-for-byte.
 *
 * Returns the rebuilt absolute file_path, or null when the basename does not
 * parse as a recording (the row is left untouched by the caller).
 */
function rebuildFilePath(oldFilePath, newFolder) {
    const name = path.basename(oldFilePath);
    const parsed = parseRecordingFilename(name);
    if (!parsed) {
        return null;
    }
    const partSuffix = parsed.part > 1 ? `.part${parsed.part}` : '';
    const newName = `${newFolder}-${parsed.date}-${parsed.hour}${partSuffix}.${parsed.ext}`;
    return path.join(audioBaseDir(), newFolder, newName);
}

/**
 * RENAME a stream's folder (invoked when an update changes `folder`): validate,
 * refuse if recording now, MOVE the dir, re-point every recordings row.
 *
 * Validation (RenameValidationError -> 400):
 *   - newFolder passes the allowlist (isValidFolder) and differs from oldFolder;
 *   - newFolder is NOT already an existing folder on disk.
 * Live-recorder guard: the SAME concrete current-slot predicate as DELETE
 * (StreamRecordingNowError -> 409) — never rename a folder recorded into this
 * very hour.
 *
 * Move: fs.rename(oldPath -> newPath) relocates every recording + .json peak
 * sibling in one dir move. Then, for each recordings row of oldFolder, the row's
 * stream_folder is set to newFolder and file_path is REBUILT stamp-anchored
 * (rebuildFilePath) — NOT a blind REPLACE. Inner-file handling iterates
 * readdir(newPath) after the move so the .json peak siblings travel with their
 * recordings (they share the dir move; fs.existsSync is used when a sibling must
 * be checked individually).
 *
 * After the move + row rebuild, disk and DB agree, so a subsequent reconcile is
 * a true no-op. Returns { from, to, movedFiles, rowsRepointed }.
 */
function renameStreamFolder(oldFolder, newFolder, { fs = realFs, db = dbHandle, now = new Date() } = {}) {
    if (!isValidFolder(newFolder)) {
        throw new RenameValidationError(`invalid folder: ${newFolder}`);
    }
    if (newFolder === oldFolder) {
        throw new RenameValidationError('new folder must differ from the current folder');
    }

    const oldPath = safeFolderPath(oldFolder);
    const newPath = safeFolderPath(newFolder);

    if (fs.existsSync(newPath)) {
        throw new RenameValidationError(`folder already exists on disk: ${newFolder}`);
    }

    if (isRecordingNow(db, oldFolder, now)) {
        throw new StreamRecordingNowError();
    }

    // MOVE the whole dir (fs.rename of oldPath -> newPath relocates every file
    // in one cheap op). A missing source dir is tolerated: the stream may simply
    // have no recordings yet, in which case there are no rows to re-point either.
    //
    // The recorder's canonical name EMBEDS the folder as a prefix
    // (`<folder>-YYYY-MM-DD-HH[.partN].<ext>` and the `<folder>-...-HH.json` peak
    // sibling), so after the dir move each inner file still carries the OLD
    // prefix. We rename every recording + its .json sibling to the NEW prefix so
    // the on-disk basename matches the stamp-anchored file_path we rebuild for
    // the DB rows — otherwise a later reconcile would see a mismatch and "fix" it.
    let movedFiles = [];
    if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);

        // Inner-file handling: iterate readdir(newPath) and rename each recording
        // to the new folder prefix. Its .json peak sibling is renamed too (checked
        // with fs.existsSync, since a recording may not have peaks yet).
        for (const entry of fs.readdirSync(newPath)) {
            const parsed = parseRecordingFilename(entry);
            if (!parsed) {
                continue; // not a recording (e.g. an unrelated file) — leave it
            }
            const partSuffix = parsed.part > 1 ? `.part${parsed.part}` : '';
            const stamp = `${parsed.date}-${parsed.hour}`;
            const newName = `${newFolder}-${stamp}${partSuffix}.${parsed.ext}`;
            if (newName !== entry) {
                fs.renameSync(path.join(newPath, entry), path.join(newPath, newName));
            }

            // The .json peak sibling is named `<folder>-<date>-<hour>.json` (one
            // per hour, shared across .partN segments). We attempt the rename for
            // every segment of the hour; existsSync makes it a safe no-op once the
            // sibling is already renamed (or when a recording has no peaks yet).
            const oldJson = path.join(newPath, `${parsed.folder}-${stamp}.json`);
            const newJson = path.join(newPath, `${newFolder}-${stamp}.json`);
            if (oldJson !== newJson && fs.existsSync(oldJson)) {
                fs.renameSync(oldJson, newJson);
            }
        }
        movedFiles = fs.readdirSync(newPath);
    }

    // Re-point every recordings row for the old folder: new stream_folder +
    // stamp-anchored rebuilt file_path, in one transaction.
    let rowsRepointed = 0;
    db.exec('BEGIN');
    try {
        const rows = db
            .prepare(
                'SELECT id, file_path FROM recordings WHERE stream_folder = ?'
            )
            .all(oldFolder);
        const update = db.prepare(
            "UPDATE recordings SET stream_folder = ?, file_path = ?, updated_at = datetime('now') WHERE id = ?"
        );
        for (const row of rows) {
            const rebuilt = rebuildFilePath(row.file_path, newFolder);
            // If the stored basename does not parse (unexpected), fall back to a
            // boundary-safe dirname swap so the row still points under newFolder
            // without risking a substring clobber of the stamp.
            const newFilePath =
                rebuilt ??
                path.join(audioBaseDir(), newFolder, path.basename(row.file_path));
            update.run(newFolder, newFilePath, row.id);
            rowsRepointed += 1;
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }

    return { from: oldFolder, to: newFolder, movedFiles, rowsRepointed };
}

module.exports = {
    deletionImpact,
    deleteStreamWithFolder,
    renameStreamFolder,
    rebuildFilePath,
    isRecordingNow,
    safeFolderPath,
    RenameValidationError,
    StreamRecordingNowError,
    UnsafeFolderError,
};
