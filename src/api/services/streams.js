/**
 * Stream CRUD service over the FEAT-001 db handle (node:sqlite DatabaseSync).
 *
 * The folder UNIQUE constraint is the backstop; createStream/updateStream
 * pre-check for a duplicate folder so the route can return a clean 409 instead
 * of a raw constraint error. A DuplicateFolderError is thrown for that case.
 */
const db = require('../db');

class DuplicateFolderError extends Error {
    constructor(message = 'folder already in use') {
        super(message);
        this.name = 'DuplicateFolderError';
    }
}

class ReorderMismatchError extends Error {
    constructor(message = 'order must list every stream exactly once') {
        super(message);
        this.name = 'ReorderMismatchError';
    }
}

/** List all streams with id + timestamps (admin view), ordered by sort_order. */
function listStreams() {
    return db
        .prepare(
            'SELECT id, country, name, folder, url, sort_order, created_at, updated_at FROM streams ORDER BY sort_order IS NULL, sort_order, id'
        )
        .all();
}

/** Fetch a single stream by id, or undefined. */
function getStream(id) {
    return db
        .prepare(
            'SELECT id, country, name, folder, url, sort_order, created_at, updated_at FROM streams WHERE id = ?'
        )
        .get(id);
}

/** Fetch a single stream by its unique folder, or undefined (backup import). */
function getStreamByFolder(folder) {
    return db
        .prepare(
            'SELECT id, country, name, folder, url, sort_order, created_at, updated_at FROM streams WHERE folder = ?'
        )
        .get(folder);
}

/**
 * Insert a new stream. Pre-checks for a duplicate folder and throws
 * DuplicateFolderError if one exists. Returns the created row.
 */
function createStream({ country, name, folder, url }) {
    const clash = db
        .prepare('SELECT id FROM streams WHERE folder = ?')
        .get(folder);
    if (clash) {
        throw new DuplicateFolderError();
    }

    const result = db
        .prepare(
            `INSERT INTO streams (country, name, folder, url, sort_order)
             VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM streams))`
        )
        .run(country, name, folder, url);
    return getStream(Number(result.lastInsertRowid));
}

/**
 * Update an existing stream and bump updated_at. Returns the updated row, or
 * null if no row with that id exists. Throws DuplicateFolderError if the new
 * folder collides with a different row.
 */
function updateStream(id, { country, name, folder, url }) {
    const existing = getStream(id);
    if (!existing) {
        return null;
    }

    const clash = db
        .prepare('SELECT id FROM streams WHERE folder = ? AND id != ?')
        .get(folder, id);
    if (clash) {
        throw new DuplicateFolderError();
    }

    db.prepare(
        "UPDATE streams SET country = ?, name = ?, folder = ?, url = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(country, name, folder, url, id);
    return getStream(id);
}

/**
 * Delete a stream by id. Returns true if a row was removed, false if the id did
 * not exist.
 */
function deleteStream(id) {
    const result = db.prepare('DELETE FROM streams WHERE id = ?').run(id);
    return result.changes > 0;
}

/**
 * Reassign sort_order to every stream from the given ordered list of ids. The
 * set of ids must exactly match the current full set of stream ids (same
 * length, same members); any mismatch throws ReorderMismatchError and nothing
 * is written. On success each id's sort_order is set to its index in the array
 * inside a single transaction (rolled back on any error).
 */
function reorderStreams(orderedIds) {
    const currentIds = db
        .prepare('SELECT id FROM streams')
        .all()
        .map((r) => r.id);

    if (!Array.isArray(orderedIds) || orderedIds.length !== currentIds.length) {
        throw new ReorderMismatchError();
    }

    const currentSet = new Set(currentIds);
    const orderedSet = new Set(orderedIds);
    if (orderedSet.size !== orderedIds.length) {
        // duplicate ids in the input
        throw new ReorderMismatchError();
    }
    for (const id of orderedIds) {
        if (!currentSet.has(id)) {
            throw new ReorderMismatchError();
        }
    }

    db.exec('BEGIN');
    try {
        const stmt = db.prepare(
            "UPDATE streams SET sort_order = ?, updated_at = datetime('now') WHERE id = ?"
        );
        orderedIds.forEach((id, index) => {
            stmt.run(index, id);
        });
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

module.exports = {
    listStreams,
    getStream,
    getStreamByFolder,
    createStream,
    updateStream,
    deleteStream,
    reorderStreams,
    DuplicateFolderError,
    ReorderMismatchError,
};
