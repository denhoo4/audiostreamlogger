// streams-db.js (cleaner)
const { DatabaseSync } = require('node:sqlite');
const DB_PATH = '/usr/src/app/data/app.db';
const SERVICE_NAME = 'cleaner';
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
module.exports = { readStreams };
