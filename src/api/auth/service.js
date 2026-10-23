/**
 * Auth service: password hashing/verification and user lookup against the
 * FEAT-001 db handle (node:sqlite DatabaseSync).
 *
 * Passwords are stored only as Argon2id hashes (library defaults). This module
 * owns the user-row read/write for the auth routes; the routes own the HTTP
 * shape and session handling.
 */
const argon2 = require('argon2');
const db = require('../db');

/** Hash a plaintext password with Argon2id (library defaults). */
function hashPassword(password) {
    return argon2.hash(password, { type: argon2.argon2id });
}

/** Verify a plaintext password against a stored Argon2id hash. */
function verifyPassword(hash, password) {
    return argon2.verify(hash, password);
}

/** Look up a user row by username, or undefined if none. */
function getUserByUsername(username) {
    return db
        .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
        .get(username);
}

/**
 * Replace a user's password hash and bump updated_at. Returns the number of
 * rows changed (1 on success, 0 if the id did not exist).
 */
async function changePassword(userId, newPassword) {
    const passwordHash = await hashPassword(newPassword);
    const result = db
        .prepare(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .run(passwordHash, userId);
    return result.changes;
}

module.exports = {
    hashPassword,
    verifyPassword,
    getUserByUsername,
    changePassword,
};
