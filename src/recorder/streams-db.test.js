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

const { readStreams, readRecorderMinute } = require('./streams-db');

// Build a temp DB with a minimal `streams` table carrying the FEAT-001 quality
// columns and seed the given rows. Used by the readStreams() coverage below.
function buildStreamsDb(streamRows) {
    try {
        fs.rmSync(TMP_DB, { force: true });
    } catch { /* ignore */ }
    const db = new DatabaseSync(TMP_DB);
    try {
        db.exec(`
            CREATE TABLE streams (
              id INTEGER PRIMARY KEY,
              country TEXT, name TEXT, folder TEXT, url TEXT,
              codec TEXT NOT NULL DEFAULT 'mp3',
              bitrate_kbps INTEGER,
              bit_depth INTEGER
            )
        `);
        const stmt = db.prepare(
            'INSERT INTO streams (country, name, folder, url, codec, bitrate_kbps, bit_depth) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (const r of streamRows) {
            stmt.run(r.country, r.name, r.folder, r.url, r.codec, r.bitrate_kbps ?? null, r.bit_depth ?? null);
        }
    } finally {
        db.close();
    }
}

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

test('readStreams: returns the per-stream codec/bitrate_kbps/bit_depth columns', () => {
    buildStreamsDb([
        { country: 'nl', name: 'Radio 1', folder: 'radio1', url: 'http://a', codec: 'mp3', bitrate_kbps: 160, bit_depth: null },
        { country: 'nl', name: 'Opus FM', folder: 'opusfm', url: 'http://b', codec: 'opus', bitrate_kbps: 128, bit_depth: null },
        { country: 'nl', name: 'Flac FM', folder: 'flacfm', url: 'http://c', codec: 'flac', bitrate_kbps: null, bit_depth: 24 },
    ]);
    const streams = readStreams();
    assert.strictEqual(streams.length, 3);
    assert.strictEqual(streams[0].country, 'nl');
    assert.strictEqual(streams[0].name, 'Radio 1');
    assert.strictEqual(streams[0].folder, 'radio1');
    assert.strictEqual(streams[0].url, 'http://a');
    assert.strictEqual(streams[0].codec, 'mp3');
    assert.strictEqual(streams[0].bitrate_kbps, 160);
    assert.strictEqual(streams[0].bit_depth, null);
    assert.strictEqual(streams[1].codec, 'opus');
    assert.strictEqual(streams[1].bitrate_kbps, 128);
    assert.strictEqual(streams[2].codec, 'flac');
    assert.strictEqual(streams[2].bit_depth, 24);
});

test('readStreams: returns [] when the DB is not ready (no file/table)', () => {
    try {
        fs.rmSync(TMP_DB, { force: true });
    } catch { /* ignore */ }
    assert.deepStrictEqual(readStreams(), []);
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
