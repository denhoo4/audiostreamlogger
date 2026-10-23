// streams-db.js (recorder)
const { DatabaseSync } = require('node:sqlite');
// Fixed mount path in the container; an env override exists only so tests can
// point the read-only reads at a temp DB (mirrors the worker's DB_PATH override).
const DB_PATH = process.env.DB_PATH || '/usr/src/app/data/app.db';
const SERVICE_NAME = 'recorder';
function readStreams() {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const rows = db.prepare(
        'SELECT country, name, folder, url FROM streams'
      ).all();
      return rows;
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`${SERVICE_NAME}: streams DB not ready, using empty stream list this tick:`, err.message);
    return [];
  }
}

// Read the recorder schedule minute from the shared DB (read-only), mirroring
// readStreams()' not-ready posture (NFR-4): open the :ro handle, SELECT the
// app_config row, parse + validate 0..59, return a number. On a not-ready DB,
// a missing row, or an out-of-range/non-integer value, log and return the safe
// default 0 (NEVER process.exit) — the recorder's 5-minute re-read timer then
// self-corrects once the real value is available.
function readRecorderMinute() {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const row = db.prepare(
        "SELECT value FROM app_config WHERE key = 'recorder_minute'"
      ).get();
      if (!row) {
        console.error(`${SERVICE_NAME}: recorder_minute not set in app_config, using default minute 0.`);
        return 0;
      }
      const minute = Number(row.value);
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
        console.error(`${SERVICE_NAME}: recorder_minute value ${JSON.stringify(row.value)} is not an integer 0..59, using default minute 0.`);
        return 0;
      }
      return minute;
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`${SERVICE_NAME}: config DB not ready, using default recorder minute 0 this read:`, err.message);
    return 0;
  }
}

module.exports = { readStreams, readRecorderMinute };
