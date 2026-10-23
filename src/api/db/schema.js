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

const JOBS_TABLE = `
CREATE TABLE IF NOT EXISTS jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT    NOT NULL CHECK (type IN ('cleaner','peakfilegenerator')),
  trigger_source TEXT    NOT NULL CHECK (trigger_source IN ('manual','schedule')),
  status         TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','done','failed','skipped')),
  output         TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  started_at     TEXT,
  finished_at    TEXT
);
`;

const JOBS_STATUS_CREATED_INDEX = `
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at, id);
`;

const JOBS_CREATED_INDEX = `
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at, id);
`;

const SCHEDULES_TABLE = `
CREATE TABLE IF NOT EXISTS schedules (
  type        TEXT    PRIMARY KEY CHECK (type IN ('cleaner','peakfilegenerator')),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  frequency   TEXT    NOT NULL DEFAULT 'hourly'
                CHECK (frequency IN ('hourly','daily','weekly')),
  minute      INTEGER NOT NULL DEFAULT 0  CHECK (minute BETWEEN 0 AND 59),
  hour        INTEGER NOT NULL DEFAULT 0  CHECK (hour BETWEEN 0 AND 23),
  day_of_week INTEGER NOT NULL DEFAULT 0  CHECK (day_of_week BETWEEN 0 AND 6),
  last_run_at TEXT
);
`;

const APP_CONFIG_TABLE = `
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function applySchema(db) {
    db.exec(STREAMS_TABLE);
    db.exec(USERS_TABLE);
    db.exec(JOBS_TABLE);
    db.exec(JOBS_STATUS_CREATED_INDEX);
    db.exec(JOBS_CREATED_INDEX);
    db.exec(SCHEDULES_TABLE);
    db.exec(APP_CONFIG_TABLE);
}

module.exports = { applySchema };
