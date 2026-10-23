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

const { applySchema } = require('../db/schema');

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
        'created_at',
        'updated_at',
    ]);
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
