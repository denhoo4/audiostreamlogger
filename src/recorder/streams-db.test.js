const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Point the read-only reads at a temp DB BEFORE requiring the module (DB_PATH is
// resolved once at require time). The recorder opens a fresh read-only handle on
// every call, so recreating the file at this path between tests is enough.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-db-'));
const TMP_DB = path.join(TMP_DIR, 'app.db');
process.env.DB_PATH = TMP_DB;

const { readRecorderMinute } = require('./streams-db');

// Build a temp DB with the minimal app_config shape and an optional seeded
// recorder_minute value. Pass `undefined` to leave the row absent.
function buildDb(recorderMinuteValue) {
    try {
        fs.rmSync(TMP_DB, { force: true });
    } catch { /* ignore */ }
    const db = new DatabaseSync(TMP_DB);
    try {
        db.exec('CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        if (recorderMinuteValue !== undefined) {
            db.prepare("INSERT INTO app_config (key, value) VALUES ('recorder_minute', ?)")
                .run(String(recorderMinuteValue));
        }
    } finally {
        db.close();
    }
}

test.after(() => {
    try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
});

test('readRecorderMinute: returns the stored minute as a number', () => {
    buildDb('42');
    assert.strictEqual(readRecorderMinute(), 42);
});

test('readRecorderMinute: accepts the boundary values 0 and 59', () => {
    buildDb('0');
    assert.strictEqual(readRecorderMinute(), 0);
    buildDb('59');
    assert.strictEqual(readRecorderMinute(), 59);
});

test('readRecorderMinute: falls back to 0 when the row is absent', () => {
    buildDb(undefined);
    assert.strictEqual(readRecorderMinute(), 0);
});

test('readRecorderMinute: falls back to 0 on an out-of-range value', () => {
    buildDb('60');
    assert.strictEqual(readRecorderMinute(), 0);
    buildDb('-1');
    assert.strictEqual(readRecorderMinute(), 0);
});

test('readRecorderMinute: falls back to 0 on a non-integer value', () => {
    buildDb('12.5');
    assert.strictEqual(readRecorderMinute(), 0);
    buildDb('abc');
    assert.strictEqual(readRecorderMinute(), 0);
});

test('readRecorderMinute: falls back to 0 when the DB is not ready (no file/table)', () => {
    try {
        fs.rmSync(TMP_DB, { force: true });
    } catch { /* ignore */ }
    // A missing file makes the read-only open throw -> caught -> default 0.
    assert.strictEqual(readRecorderMinute(), 0);
});
