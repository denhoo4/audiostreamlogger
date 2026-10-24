const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Point the recorder RW handle at a temp DB BEFORE requiring the module (DB_PATH
// is resolved once at require time), mirroring streams-db.test.js. The table is
// created inline with the same DDL the api ships (FEAT-001) so this recorder
// test stays self-contained and never requires api-side code.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-recordings-'));
const TMP_DB = path.join(TMP_DIR, 'app.db');
process.env.DB_PATH = TMP_DB;

const RECORDINGS_DDL = `
CREATE TABLE recordings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_folder    TEXT    NOT NULL,
  date             TEXT    NOT NULL,
  hour             TEXT    NOT NULL,
  file_path        TEXT    NOT NULL,
  status           TEXT    NOT NULL
                     CHECK (status IN ('recording','complete','partial','missing')),
  duration_seconds REAL,
  size_bytes       INTEGER,
  segment_count    INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (stream_folder, date, hour)
);
`;

// Rebuild a fresh temp DB with just the recordings table before each test.
function buildDb() {
    try {
        fs.rmSync(TMP_DB, { force: true });
    } catch { /* ignore */ }
    const db = new DatabaseSync(TMP_DB);
    try {
        db.exec(RECORDINGS_DDL);
    } finally {
        db.close();
    }
}

// Open a throwaway read handle to inspect the written rows.
function rows() {
    const db = new DatabaseSync(TMP_DB, { readOnly: true });
    try {
        return db.prepare('SELECT * FROM recordings ORDER BY id').all();
    } finally {
        db.close();
    }
}

const {
    openDb,
    parseStamp,
    upsertRecordingStart,
    markSegment,
    markComplete,
} = require('./recordings-db');

test.after(() => {
    try {
        fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
});

test('parseStamp: splits a YYYY-MM-DD-HH stamp into date + hour', () => {
    assert.deepStrictEqual(parseStamp('2026-10-23-14'), { date: '2026-10-23', hour: '14' });
});

test('parseStamp: returns null for a malformed stamp', () => {
    assert.strictEqual(parseStamp('2026-10-23'), null);
    assert.strictEqual(parseStamp('nonsense'), null);
    assert.strictEqual(parseStamp(''), null);
});

test('upsertRecordingStart: inserts a recording row with the primary file_path', () => {
    buildDb();
    const db = openDb();
    try {
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14' });
    } finally {
        db.close();
    }
    const all = rows();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].stream_folder, 'radio1');
    assert.strictEqual(all[0].date, '2026-10-23');
    assert.strictEqual(all[0].hour, '14');
    assert.strictEqual(all[0].file_path, 'radio1-2026-10-23-14.mp3');
    assert.strictEqual(all[0].status, 'recording');
    assert.strictEqual(all[0].segment_count, 1);
    assert.strictEqual(all[0].size_bytes, null);
});

test('upsertRecordingStart: builds the primary file_path with a per-stream extension', () => {
    buildDb();
    const db = openDb();
    try {
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14', ext: 'opus' });
        upsertRecordingStart(db, { folder: 'radio2', stamp: '2026-10-23-14', ext: 'flac' });
    } finally {
        db.close();
    }
    const all = rows();
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all[0].file_path, 'radio1-2026-10-23-14.opus');
    assert.strictEqual(all[1].file_path, 'radio2-2026-10-23-14.flac');
});

test('upsertRecordingStart: defaults ext to mp3 when omitted (behaviour-preserving)', () => {
    buildDb();
    const db = openDb();
    try {
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14' });
    } finally {
        db.close();
    }
    assert.strictEqual(rows()[0].file_path, 'radio1-2026-10-23-14.mp3');
});

test('upsertRecordingStart: a second start for the same hour does not duplicate or clobber', () => {
    buildDb();
    const db = openDb();
    try {
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14' });
        // Promote the hour to 'partial' then re-run start: the ON CONFLICT DO
        // NOTHING must leave the existing row untouched (no downgrade, no dup).
        markSegment(db, { folder: 'radio1', stamp: '2026-10-23-14', attempt: 1 });
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14' });
    } finally {
        db.close();
    }
    const all = rows();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].status, 'partial');
    assert.strictEqual(all[0].segment_count, 2);
});

test('markSegment: flips to partial with segment_count = attempt + 1', () => {
    buildDb();
    const db = openDb();
    try {
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14' });
        markSegment(db, { folder: 'radio1', stamp: '2026-10-23-14', attempt: 2 });
    } finally {
        db.close();
    }
    const all = rows();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].status, 'partial');
    assert.strictEqual(all[0].segment_count, 3);
});

test('markComplete: sets complete + size_bytes on a plain recording row', () => {
    buildDb();
    const db = openDb();
    try {
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14' });
        markComplete(db, { folder: 'radio1', stamp: '2026-10-23-14', sizeBytes: 12345 });
    } finally {
        db.close();
    }
    const all = rows();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].status, 'complete');
    assert.strictEqual(all[0].size_bytes, 12345);
});

test('markComplete: does NOT downgrade an already-partial hour to complete', () => {
    buildDb();
    const db = openDb();
    try {
        upsertRecordingStart(db, { folder: 'radio1', stamp: '2026-10-23-14' });
        markSegment(db, { folder: 'radio1', stamp: '2026-10-23-14', attempt: 1 });
        markComplete(db, { folder: 'radio1', stamp: '2026-10-23-14', sizeBytes: 999 });
    } finally {
        db.close();
    }
    const all = rows();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].status, 'partial');
    // size_bytes is still recorded even though the status stays 'partial'.
    assert.strictEqual(all[0].size_bytes, 999);
    assert.strictEqual(all[0].segment_count, 2);
});
