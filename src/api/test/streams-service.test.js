/**
 * Service-level coverage for streams.js ordering + reorder (FEAT-001). Uses the
 * temp-DB require.cache injection pattern from streams-routes.test.js, but
 * exercises the service functions directly instead of over HTTP:
 *
 *   - listStreams returns rows ordered by sort_order (then id);
 *   - createStream appends with the next sort_order;
 *   - reorderStreams reassigns sort_order by array index;
 *   - reorderStreams throws ReorderMismatchError when the id set does not match.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let tmpDir;
let db;
let streams;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-streamsvc-'));
    const dbPath = path.join(tmpDir, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');

    const dbModulePath = require.resolve('../db');
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: db,
    };

    applySchema(db);
    streams = require('../services/streams');
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    db.exec('DELETE FROM streams');
});

function makeStream(suffix) {
    return streams.createStream({
        country: 'NL',
        name: `Stream ${suffix}`,
        folder: `stream_${suffix}`,
        url: `https://example.com/${suffix}`,
    });
}

test('createStream appends each new row with the next sort_order', () => {
    const a = makeStream('a');
    const b = makeStream('b');
    const c = makeStream('c');

    assert.strictEqual(a.sort_order, 1);
    assert.strictEqual(b.sort_order, 2);
    assert.strictEqual(c.sort_order, 3);
});

test('listStreams returns rows ordered by sort_order', () => {
    const a = makeStream('a');
    const b = makeStream('b');
    const c = makeStream('c');

    // Scramble the stored sort_order so plain id-order would differ.
    db.prepare('UPDATE streams SET sort_order = ? WHERE id = ?').run(30, a.id);
    db.prepare('UPDATE streams SET sort_order = ? WHERE id = ?').run(10, b.id);
    db.prepare('UPDATE streams SET sort_order = ? WHERE id = ?').run(20, c.id);

    const folders = streams.listStreams().map((s) => s.folder);
    assert.deepStrictEqual(folders, ['stream_b', 'stream_c', 'stream_a']);
});

test('reorderStreams reassigns sort_order by array index', () => {
    const a = makeStream('a');
    const b = makeStream('b');
    const c = makeStream('c');

    streams.reorderStreams([c.id, a.id, b.id]);

    const rows = streams.listStreams();
    assert.deepStrictEqual(
        rows.map((s) => s.id),
        [c.id, a.id, b.id]
    );
    assert.deepStrictEqual(
        rows.map((s) => s.sort_order),
        [0, 1, 2]
    );
});

test('reorderStreams throws ReorderMismatchError on a wrong-length id set', () => {
    const a = makeStream('a');
    makeStream('b');

    assert.throws(
        () => streams.reorderStreams([a.id]),
        streams.ReorderMismatchError
    );
});

test('reorderStreams throws ReorderMismatchError on an unknown id', () => {
    const a = makeStream('a');
    const b = makeStream('b');

    assert.throws(
        () => streams.reorderStreams([a.id, b.id + 999]),
        streams.ReorderMismatchError
    );
});

test('reorderStreams throws ReorderMismatchError on a duplicate id', () => {
    const a = makeStream('a');
    makeStream('b');

    assert.throws(
        () => streams.reorderStreams([a.id, a.id]),
        streams.ReorderMismatchError
    );
});
