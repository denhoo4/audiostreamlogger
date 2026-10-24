/**
 * Schema coverage for the additive streams.sort_order migration (FEAT-001).
 * Uses the temp-DB pattern from test/recordings-schema.test.js:
 *
 *   (a) a fresh DB after applySchema has a sort_order column on streams;
 *   (b) a pre-existing, column-less streams table + rows migrates in place:
 *       applySchema adds the column and backfills sort_order=id with no row
 *       loss;
 *   (c) a second applySchema does not throw and does not change values
 *       (idempotent).
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-sortorder-schema-'));
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

test('a fresh DB after applySchema has a sort_order column on streams', () => {
    const db = openTempDb('fresh.db');
    applySchema(db);
    const cols = db
        .prepare('PRAGMA table_info(streams)')
        .all()
        .map((c) => c.name);
    assert.ok(cols.includes('sort_order'), 'expected a sort_order column');
    db.close();
});

test('an existing column-less streams table migrates in place (column added, backfilled sort_order=id, no row loss)', () => {
    const db = openTempDb('legacy.db');

    // Build a legacy streams table WITHOUT sort_order, like an old app.db.
    db.exec(`
        CREATE TABLE streams (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          country    TEXT NOT NULL CHECK (length(country) = 2),
          name       TEXT NOT NULL,
          folder     TEXT NOT NULL UNIQUE,
          url        TEXT NOT NULL,
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
    assert.ok(cols.includes('sort_order'), 'sort_order column must be added');

    const afterCount = db.prepare('SELECT COUNT(*) AS n FROM streams').get().n;
    assert.strictEqual(afterCount, beforeCount, 'no rows lost by the migration');

    const rows = db
        .prepare('SELECT id, sort_order FROM streams ORDER BY id')
        .all();
    for (const row of rows) {
        assert.strictEqual(
            row.sort_order,
            row.id,
            'sort_order must be backfilled to equal id'
        );
    }

    db.close();
});

test('a second applySchema is idempotent (does not throw, preserves values)', () => {
    const db = openTempDb('idempotent.db');
    applySchema(db);

    db.prepare(
        'INSERT INTO streams (country, name, folder, url) VALUES (?, ?, ?, ?)'
    ).run('NL', 'One', 'one', 'https://example.com/one');
    // Give it a deliberately non-id sort_order to prove a re-run won't rewrite it.
    db.prepare('UPDATE streams SET sort_order = 42 WHERE folder = ?').run('one');

    const before = db
        .prepare('SELECT id, sort_order FROM streams ORDER BY id')
        .all();

    assert.doesNotThrow(() => applySchema(db));

    const after = db
        .prepare('SELECT id, sort_order FROM streams ORDER BY id')
        .all();
    assert.deepStrictEqual(after, before, 'values unchanged on a second run');

    db.close();
});
