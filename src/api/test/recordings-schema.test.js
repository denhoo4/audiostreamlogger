/**
 * Schema coverage for the recordings table (FEAT-001). Uses the temp-DB
 * injection pattern from test/jobs-schema.test.js: a temp DatabaseSync is
 * created, applySchema is run against it, and the table/indexes/columns/UNIQUE
 * constraint + idempotency are asserted directly over that handle.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema, migrateRecordingsGapFlag } = require('../db/schema');

let tmpDir;
let db;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-rec-schema-'));
    const dbPath = path.join(tmpDir, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    applySchema(db);
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('applySchema creates the recordings table with both indexes', () => {
    const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
    assert.ok(tables.includes('recordings'), 'expected recordings table');

    const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((r) => r.name);
    assert.ok(indexes.includes('idx_recordings_folder_date'));
    assert.ok(indexes.includes('idx_recordings_date'));
});

test('recordings has the exact documented column list', () => {
    const cols = db
        .prepare('PRAGMA table_info(recordings)')
        .all()
        .map((c) => c.name);
    assert.deepStrictEqual(cols, [
        'id',
        'stream_folder',
        'date',
        'hour',
        'file_path',
        'status',
        'duration_seconds',
        'size_bytes',
        'segment_count',
        'gap_seconds',
        'has_silence',
        'created_at',
        'updated_at',
    ]);
});

test('recordings.has_silence defaults to 0 and gap_seconds is nullable (FEAT-004)', () => {
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
         VALUES ('gapfm', '2026-10-23', '10', '/audio/gapfm/x.mp3', 'complete')`
    ).run();
    const row = db
        .prepare(
            "SELECT gap_seconds, has_silence FROM recordings WHERE stream_folder='gapfm' AND date='2026-10-23' AND hour='10'"
        )
        .get();
    assert.strictEqual(row.gap_seconds, null, 'gap_seconds defaults to NULL');
    assert.strictEqual(row.has_silence, 0, 'has_silence defaults to 0');
});

test('recordings still accepts complete for a gap-padded hour (status CHECK unchanged)', () => {
    // A gap-padded hour stays 'complete' (FEAT-004) — the status CHECK is never
    // touched, so 'complete' with has_silence=1 must insert cleanly.
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, gap_seconds, has_silence)
         VALUES ('gapfm', '2026-10-23', '11', '/audio/gapfm/y.mp3', 'complete', 42, 1)`
    ).run();
    const row = db
        .prepare(
            "SELECT status, gap_seconds, has_silence FROM recordings WHERE stream_folder='gapfm' AND date='2026-10-23' AND hour='11'"
        )
        .get();
    assert.strictEqual(row.status, 'complete');
    assert.strictEqual(row.gap_seconds, 42);
    assert.strictEqual(row.has_silence, 1);
});

test('recordings.has_silence rejects a value outside {0,1} (CHECK enforced)', () => {
    assert.throws(
        () =>
            db
                .prepare(
                    `INSERT INTO recordings (stream_folder, date, hour, file_path, status, has_silence)
                     VALUES ('gapfm', '2026-10-23', '12', '/audio/gapfm/z.mp3', 'complete', 2)`
                )
                .run(),
        /CHECK/i
    );
});

test('migrateRecordingsGapFlag adds the columns to a legacy table idempotently', () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-rec-migrate-'));
    const legacy = new DatabaseSync(path.join(tmp2, 'app.db'));
    try {
        legacy.exec('PRAGMA journal_mode = DELETE');
        // A pre-FEAT-004 recordings table WITHOUT the two new columns.
        legacy.exec(`
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
        `);
        legacy.prepare(
            `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
             VALUES ('old', '2026-10-23', '00', '/audio/old/a.mp3', 'complete')`
        ).run();

        migrateRecordingsGapFlag(legacy);
        // Second call is a no-op (idempotent).
        migrateRecordingsGapFlag(legacy);

        const cols = legacy
            .prepare('PRAGMA table_info(recordings)')
            .all()
            .map((c) => c.name);
        assert.ok(cols.includes('gap_seconds'));
        assert.ok(cols.includes('has_silence'));

        // The pre-existing row survived and backfilled to has_silence=0.
        const row = legacy
            .prepare("SELECT gap_seconds, has_silence FROM recordings WHERE stream_folder='old'")
            .get();
        assert.strictEqual(row.gap_seconds, null);
        assert.strictEqual(row.has_silence, 0);
    } finally {
        legacy.close();
        fs.rmSync(tmp2, { recursive: true, force: true });
    }
});

test('recordings enforces UNIQUE(stream_folder, date, hour)', () => {
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
         VALUES ('radio1', '2026-10-23', '09', '/audio/radio1/x.mp3', 'complete')`
    ).run();

    assert.throws(
        () =>
            db
                .prepare(
                    `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
                     VALUES ('radio1', '2026-10-23', '09', '/audio/radio1/y.mp3', 'complete')`
                )
                .run(),
        /UNIQUE/i,
        'a duplicate (folder,date,hour) must violate the UNIQUE constraint'
    );
});

test('applySchema is idempotent (a second call does not throw or wipe data)', () => {
    const before = db
        .prepare('SELECT COUNT(*) AS n FROM recordings')
        .get().n;
    applySchema(db);
    const after = db.prepare('SELECT COUNT(*) AS n FROM recordings').get().n;
    assert.strictEqual(after, before, 'data preserved across a second applySchema');
});
