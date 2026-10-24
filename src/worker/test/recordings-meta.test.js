const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const {
    upsertRecordingMeta,
    deleteRecordingByFile,
    splitStamp,
} = require('../recordings-db');

// The recordings-db helpers take an injected RW handle and wrap writes in the
// worker's withBusyRetry. Exercise them against a temp DB whose `recordings`
// table mirrors the FEAT-001 DDL (same columns/constraints the api creates).
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

let tmpDir;
let db;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-rec-meta-'));
    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
});

after(() => {
    try {
        db.close();
    } catch {
        // already closed
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS recordings');
    db.exec(RECORDINGS_DDL);
});

function getRow(folder, date, hour) {
    return db
        .prepare(
            'SELECT * FROM recordings WHERE stream_folder = ? AND date = ? AND hour = ?'
        )
        .get(folder, date, hour);
}

test('splitStamp splits a YYYY-MM-DD-HH stamp and rejects bad shapes', () => {
    assert.deepStrictEqual(splitStamp('2026-10-23-14'), {
        date: '2026-10-23',
        hour: '14',
    });
    assert.strictEqual(splitStamp('2026-10-23'), null);
    assert.strictEqual(splitStamp('nope'), null);
    assert.strictEqual(splitStamp(null), null);
});

test('upsertRecordingMeta sets duration + size on an existing row', () => {
    // Seed a row like the recorder would at the start of the hour.
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES ('radio1', '2026-10-23', '14', 'radio1/radio1-2026-10-23-14.mp3', 'complete', 1)`
    ).run();

    const wrote = upsertRecordingMeta(db, {
        folder: 'radio1',
        stamp: '2026-10-23-14',
        durationSeconds: 3600.5,
        sizeBytes: 57600000,
        part: 1,
    });

    assert.strictEqual(wrote, true);
    const row = getRow('radio1', '2026-10-23', '14');
    assert.strictEqual(row.duration_seconds, 3600.5);
    assert.strictEqual(row.size_bytes, 57600000);
    assert.strictEqual(row.status, 'complete');
    assert.strictEqual(row.segment_count, 1);
    // Still exactly one row for the hour.
    const n = db
        .prepare(
            "SELECT COUNT(*) AS n FROM recordings WHERE stream_folder='radio1' AND date='2026-10-23' AND hour='14'"
        )
        .get().n;
    assert.strictEqual(n, 1);
});

test('upsertRecordingMeta inserts a row when none exists yet', () => {
    const wrote = upsertRecordingMeta(db, {
        folder: 'radio1',
        stamp: '2026-10-23-15',
        durationSeconds: 1800,
        sizeBytes: 28800000,
        part: 1,
    });

    assert.strictEqual(wrote, true);
    const row = getRow('radio1', '2026-10-23', '15');
    assert.ok(row, 'row inserted');
    assert.strictEqual(row.status, 'complete');
    assert.strictEqual(row.duration_seconds, 1800);
    assert.strictEqual(row.size_bytes, 28800000);
    assert.strictEqual(row.segment_count, 1);
    assert.strictEqual(row.file_path, 'radio1/radio1-2026-10-23-15.mp3');
});

test('upsertRecordingMeta INSERT builds a non-mp3 file_path from the ext param', () => {
    const wroteOpus = upsertRecordingMeta(db, {
        folder: 'opusfm',
        stamp: '2026-10-23-20',
        durationSeconds: 3600,
        sizeBytes: 1000,
        part: 1,
        ext: 'opus',
    });
    assert.strictEqual(wroteOpus, true);
    assert.strictEqual(
        getRow('opusfm', '2026-10-23', '20').file_path,
        'opusfm/opusfm-2026-10-23-20.opus'
    );

    const wroteFlac = upsertRecordingMeta(db, {
        folder: 'flacfm',
        stamp: '2026-10-23-21',
        durationSeconds: 3600,
        sizeBytes: 2000,
        part: 2,
        ext: 'flac',
    });
    assert.strictEqual(wroteFlac, true);
    const flacRow = getRow('flacfm', '2026-10-23', '21');
    assert.strictEqual(flacRow.file_path, 'flacfm/flacfm-2026-10-23-21.flac');
    assert.strictEqual(flacRow.status, 'partial');
    assert.strictEqual(flacRow.segment_count, 2);
});

test('upsertRecordingMeta INSERT defaults the file_path ext to mp3 when omitted', () => {
    upsertRecordingMeta(db, {
        folder: 'radio1',
        stamp: '2026-10-23-22',
        durationSeconds: 3600,
        sizeBytes: 1,
        part: 1,
    });
    assert.strictEqual(
        getRow('radio1', '2026-10-23', '22').file_path,
        'radio1/radio1-2026-10-23-22.mp3'
    );
});

test('upsertRecordingMeta marks a .partN segment partial on insert', () => {
    const wrote = upsertRecordingMeta(db, {
        folder: 'radio1',
        stamp: '2026-10-23-16',
        durationSeconds: 1200,
        sizeBytes: 19200000,
        part: 2,
    });

    assert.strictEqual(wrote, true);
    const row = getRow('radio1', '2026-10-23', '16');
    assert.strictEqual(row.status, 'partial');
    assert.strictEqual(row.segment_count, 2);
});

test('upsertRecordingMeta bumps an existing row to partial for a .partN segment', () => {
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES ('radio1', '2026-10-23', '17', 'radio1/radio1-2026-10-23-17.mp3', 'complete', 1)`
    ).run();

    upsertRecordingMeta(db, {
        folder: 'radio1',
        stamp: '2026-10-23-17',
        durationSeconds: 900,
        sizeBytes: 14400000,
        part: 3,
    });

    const row = getRow('radio1', '2026-10-23', '17');
    assert.strictEqual(row.status, 'partial');
    assert.strictEqual(row.segment_count, 3);
    assert.strictEqual(row.duration_seconds, 900);
});

test('upsertRecordingMeta returns false for an unparseable stamp', () => {
    const wrote = upsertRecordingMeta(db, {
        folder: 'radio1',
        stamp: 'not-a-stamp',
        durationSeconds: 1,
        sizeBytes: 1,
        part: 1,
    });
    assert.strictEqual(wrote, false);
});

test('deleteRecordingByFile removes the matching hour row', () => {
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
         VALUES ('radio1', '2026-10-23', '18', 'radio1/radio1-2026-10-23-18.mp3', 'complete')`
    ).run();

    const removed = deleteRecordingByFile(db, {
        folder: 'radio1',
        stamp: '2026-10-23-18',
    });

    assert.strictEqual(removed, 1);
    assert.strictEqual(getRow('radio1', '2026-10-23', '18'), undefined);
});

test('deleteRecordingByFile is a no-op (0) when no row matches', () => {
    const removed = deleteRecordingByFile(db, {
        folder: 'radio1',
        stamp: '2026-10-23-19',
    });
    assert.strictEqual(removed, 0);
});
