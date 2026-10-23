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

/** List all streams with id + timestamps (admin view). */
function listStreams() {
    return db
        .prepare(
            'SELECT id, country, name, folder, url, created_at, updated_at FROM streams ORDER BY id'
        )
        .all();
}

/** Fetch a single stream by id, or undefined. */
function getStream(id) {
    return db
        .prepare(
            'SELECT id, country, name, folder, url, created_at, updated_at FROM streams WHERE id = ?'
        )
        .get(id);
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
            'INSERT INTO streams (country, name, folder, url) VALUES (?, ?, ?, ?)'
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

module.exports = {
    listStreams,
    getStream,
    createStream,
    updateStream,
    deleteStream,
    DuplicateFolderError,
};
