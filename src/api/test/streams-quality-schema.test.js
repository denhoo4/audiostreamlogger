/**
 * Schema coverage for the additive per-stream recording-quality migration
 * (FEAT-001, design §3). Mirrors streams-sort-order-schema.test.js:
 *
 *   (a) a fresh DB after applySchema has codec/bitrate_kbps/bit_depth columns;
 *   (b) a pre-feature, column-less streams table + rows migrates in place:
 *       applySchema adds the three columns and backfills existing rows to
 *       codec='mp3' / bitrate_kbps=160 / bit_depth=NULL with no row loss;
 *   (c) a second applySchema does not throw and does not change values
 *       (idempotent) — AC-1.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let tmpDir;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-quality-schema-'));
});

after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function openTempDb(name) {
    const db = new DatabaseSync(path.join(tmpDir, name));
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    return db;
}

test('a fresh DB after applySchema has codec/bitrate_kbps/bit_depth columns on streams', () => {
    const db = openTempDb('fresh.db');
    applySchema(db);
    const cols = db
        .prepare('PRAGMA table_info(streams)')
        .all()
        .map((c) => c.name);
    assert.ok(cols.includes('codec'), 'expected a codec column');
    assert.ok(cols.includes('bitrate_kbps'), 'expected a bitrate_kbps column');
    assert.ok(cols.includes('bit_depth'), 'expected a bit_depth column');
    db.close();
});

test('an existing pre-feature streams table migrates in place (columns added, rows backfilled mp3/160/NULL, no row loss)', () => {
    const db = openTempDb('legacy.db');

    // A legacy streams table WITHOUT the quality columns (has sort_order, like
    // a post-sort-order / pre-quality app.db).
    db.exec(`
        CREATE TABLE streams (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          country    TEXT NOT NULL CHECK (length(country) = 2),
          name       TEXT NOT NULL,
          folder     TEXT NOT NULL UNIQUE,
          url        TEXT NOT NULL,
          sort_order INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    db.prepare(
        'INSERT INTO streams (country, name, folder, url) VALUES (?, ?, ?, ?)'
    ).run('NL', 'One', 'one', 'https://example.com/one');
    db.prepare(
        'INSERT INTO streams (country, name, folder, url) VALUES (?, ?, ?, ?)'
    ).run('NL', 'Two', 'two', 'https://example.com/two');

    const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM streams').get().n;

    applySchema(db);

    const cols = db
        .prepare('PRAGMA table_info(streams)')
        .all()
        .map((c) => c.name);
    assert.ok(cols.includes('codec'), 'codec column must be added');
    assert.ok(cols.includes('bitrate_kbps'), 'bitrate_kbps column must be added');
    assert.ok(cols.includes('bit_depth'), 'bit_depth column must be added');

    const afterCount = db.prepare('SELECT COUNT(*) AS n FROM streams').get().n;
    assert.strictEqual(afterCount, beforeCount, 'no rows lost by the migration');

    const rows = db
        .prepare('SELECT codec, bitrate_kbps, bit_depth FROM streams ORDER BY id')
        .all();
    for (const row of rows) {
        assert.strictEqual(row.codec, 'mp3', 'codec backfilled to mp3');
        assert.strictEqual(row.bitrate_kbps, 160, 'bitrate_kbps backfilled to 160');
        assert.strictEqual(row.bit_depth, null, 'bit_depth stays NULL');
    }

    db.close();
});

test('a second applySchema is idempotent (does not throw, preserves values)', () => {
    const db = openTempDb('idempotent.db');
    applySchema(db);

    db.prepare(
        'INSERT INTO streams (country, name, folder, url, codec, bitrate_kbps, bit_depth) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('NL', 'Opus', 'opus_one', 'https://example.com/opus', 'opus', 128, null);

    const before = db
        .prepare('SELECT codec, bitrate_kbps, bit_depth FROM streams ORDER BY id')
        .all();

    assert.doesNotThrow(() => applySchema(db));

    const after = db
        .prepare('SELECT codec, bitrate_kbps, bit_depth FROM streams ORDER BY id')
        .all();
    assert.deepStrictEqual(after, before, 'values unchanged on a second run');

    db.close();
});
