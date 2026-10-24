/**
 * Integration coverage for the PUBLIC read projections on the /api router
 * (routes/api.js): GET /api/settings and GET /api/settings2. Neither is behind
 * requireAuth — they feed the anonymous player — so this suite mounts the router
 * with NO session middleware at all to prove they respond 200 without a session.
 *
 * Uses the FEAT-001 temp-DB injection + ephemeral-server pattern. settings2
 * scans an audio dir that does not exist in the temp tree, which browse.js maps
 * to an empty tree ({}), so the empty-recordings case is exercised here.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let tmpDir;
let db;
let streamsSvc;
let server;
let baseUrl;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-settingsroutes-'));
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
    streamsSvc = require('../services/streams');

    // Seed a couple of streams the public projections will read.
    streamsSvc.createStream({
        country: 'NL',
        name: 'NL One',
        folder: 'nl_one',
        url: 'https://example.com/nl1',
    });
    streamsSvc.createStream({
        country: 'BE',
        name: 'BE Two',
        folder: 'be_two',
        url: 'https://example.com/be2',
    });

    const apiRouter = require('../routes/api');
    const app = express();
    // NO session middleware: these routes must work for an anonymous client.
    app.use('/api', apiRouter);

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function getJson(pathname) {
    return fetch(`${baseUrl}${pathname}`).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => undefined),
    }));
}

test('GET /api/settings is public and returns only {country,name,folder,url}', async () => {
    const res = await getJson('/api/settings');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 2);

    for (const s of res.body) {
        assert.deepStrictEqual(
            Object.keys(s).sort(),
            ['codec', 'country', 'folder', 'name', 'url']
        );
        // The player derives the file extension from codec (codec === ext).
        assert.strictEqual(s.codec, 'mp3');
        // No admin-only fields leak to the public projection.
        assert.ok(!('id' in s));
        assert.ok(!('created_at' in s));
        assert.ok(!('updated_at' in s));
        assert.ok(!('bitrate_kbps' in s));
        assert.ok(!('bit_depth' in s));
    }
});

test('GET /api/settings2 is public and returns the nested browse tree', async () => {
    const res = await getJson('/api/settings2');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.body, 'object');
    assert.ok(!Array.isArray(res.body));
    // No audio dir exists in the temp tree, so each station folds to an empty
    // logs tree — the tree is keyed by station name.
    assert.ok('NL One' in res.body);
    assert.ok('BE Two' in res.body);
});
