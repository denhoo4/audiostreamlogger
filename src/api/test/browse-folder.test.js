/**
 * Coverage for browse.folderContent: the per-folder audio scan that feeds the
 * /settings2 browse tree lists .mp3/.opus/.aac/.flac hours (not only .mp3).
 * Pure-ish fs scan over a temp dir — no DB, no server.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let tmpDir;
let folderPath;
let db;
let folderContent;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-browse-'));
    folderPath = path.join(tmpDir, 'radio1');
    fs.mkdirSync(folderPath, { recursive: true });

    // browse.js pulls in services/streams, which opens the shared DB at module
    // load — inject a temp DB via the require.cache pattern before requiring it.
    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    const dbModulePath = require.resolve('../db');
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: db,
    };
    applySchema(db);
    ({ folderContent } = require('../services/browse'));
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('folderContent returns {} for a folder that does not exist yet', async () => {
    const missing = path.join(tmpDir, 'nope');
    assert.deepStrictEqual(await folderContent(missing), {});
});

test('folderContent lists mp3, opus, aac, and flac recorded hours', async () => {
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-09.mp3'), 'x');
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-10.opus'), 'x');
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-11.flac'), 'x');
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-12.aac'), 'x');
    // Non-audio sidecars and still-unsupported extensions are ignored.
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-09.json'), '{}');
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-13.wav'), 'x');

    const tree = await folderContent(folderPath);
    const hours = tree['2026']['10']['23'];
    assert.ok(hours.includes('09'), 'mp3 hour listed');
    assert.ok(hours.includes('10'), 'opus hour listed');
    assert.ok(hours.includes('11'), 'flac hour listed');
    assert.ok(hours.includes('12'), 'aac hour listed (FEAT-001)');
    assert.ok(!hours.includes('13'), 'wav hour NOT listed (not allowlisted)');
    assert.strictEqual(hours.length, 4);

    // cleanup so the .live-specific tests below start from a known tree.
    for (const f of fs.readdirSync(folderPath)) {
        fs.rmSync(path.join(folderPath, f), { recursive: true, force: true });
    }
});

test('folderContent surfaces the current hour from a .live/<stamp> preview (FEAT-002)', async () => {
    // Only a live preview exists for hour 14 — no canonical primary yet — and it
    // must still be offered so the live hour is selectable.
    const liveDir = path.join(folderPath, '.live');
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, '2026-10-23-14.mp3'), 'x');

    const tree = await folderContent(folderPath);
    const hours = tree['2026']['10']['23'];
    assert.ok(hours.includes('14'), 'live hour surfaced from .live preview');
    assert.strictEqual(hours.length, 1);

    fs.rmSync(liveDir, { recursive: true, force: true });
});

test('folderContent folds a .live preview hour into the same day as primaries, and never lists .live itself', async () => {
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-09.mp3'), 'x');
    const liveDir = path.join(folderPath, '.live');
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, '2026-10-23-10.aac'), 'x');
    // A non-stamp entry inside .live must never surface as an hour.
    fs.writeFileSync(path.join(liveDir, '.live-tmp.123.aac'), 'x');

    const tree = await folderContent(folderPath);
    const hours = tree['2026']['10']['23'];
    assert.ok(hours.includes('09'), 'primary hour listed');
    assert.ok(hours.includes('10'), 'live-preview hour listed');
    assert.strictEqual(hours.length, 2);
    // `.live` is a dir name, never a year key in the tree.
    assert.ok(!Object.prototype.hasOwnProperty.call(tree, '.live'));

    for (const f of fs.readdirSync(folderPath)) {
        fs.rmSync(path.join(folderPath, f), { recursive: true, force: true });
    }
});

test('folderContent ignores a missing .live dir (ENOENT) without error', async () => {
    fs.writeFileSync(path.join(folderPath, 'radio1-2026-10-23-08.mp3'), 'x');
    const tree = await folderContent(folderPath);
    assert.deepStrictEqual(tree['2026']['10']['23'], ['08']);
    for (const f of fs.readdirSync(folderPath)) {
        fs.rmSync(path.join(folderPath, f), { recursive: true, force: true });
    }
});
