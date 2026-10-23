/**
 * Idempotent schema creation for the api's SQLite database.
 *
 * applySchema(db) runs `CREATE TABLE IF NOT EXISTS` for each table. Each
 * table's DDL is kept as a separate string so a future table (e.g. a
 * `recordings` table or config rows) is a localized add here rather than a
 * rewrite.
 *
 * `streams.country` holds an ISO 3166-1 alpha-2 code (e.g. 'NL'), never a full
 * name. The `CHECK (length(country) = 2)` is a cheap shape backstop only; the
 * authoritative membership + uppercase rule lives in lib/validate-stream.js
 * (see design §2.3).
 */

const STREAMS_TABLE = `
CREATE TABLE IF NOT EXISTS streams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  country    TEXT NOT NULL CHECK (length(country) = 2),
  name       TEXT NOT NULL,
  folder     TEXT NOT NULL UNIQUE,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function applySchema(db) {
    db.exec(STREAMS_TABLE);
    db.exec(USERS_TABLE);
}

module.exports = { applySchema };
