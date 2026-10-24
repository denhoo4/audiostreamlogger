/**
 * Integration coverage for the /api router's stream CRUD (routes/api.js):
 * GET/POST/PUT/DELETE /api/streams, all behind requireAuth, plus the write-path
 * validation (folder/country/url) and duplicate/not-found paths.
 *
 * Reuses the FEAT-001 temp-DB injection + ephemeral-server pattern from
 * jobs-routes.test.js: a temp SQLite handle is injected via require.cache before
 * requiring the router/services, the router is mounted in a minimal Express app
 * whose fake session middleware can be toggled authenticated/anonymous, and the
 * suite drives it with fetch. (The pure validator itself is covered by
 * validate-stream.test.js; this suite proves the HTTP wiring + status codes.)
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let tmpDir;
let db;
let server;
let baseUrl;
let authenticated = true;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-streamroutes-'));
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

    const apiRouter = require('../routes/api');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = authenticated ? { userId: 1, username: 'admin' } : {};
        next();
    });
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

beforeEach(() => {
    authenticated = true;
    db.exec('DELETE FROM streams');
});

function reqJson(method, pathname, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    return fetch(`${baseUrl}${pathname}`, opts).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => undefined),
    }));
}

const GOOD = {
    country: 'NL',
    name: 'Test Stream',
    folder: 'test_stream',
    url: 'https://example.com/stream',
};

test('GET /api/streams requires auth (401 anonymous)', async () => {
    authenticated = false;
    const res = await reqJson('GET', '/api/streams');
    assert.strictEqual(res.status, 401);
});

test('POST/PUT/DELETE /api/streams require auth (401 anonymous)', async () => {
    authenticated = false;
    assert.strictEqual((await reqJson('POST', '/api/streams', GOOD)).status, 401);
    assert.strictEqual((await reqJson('PUT', '/api/streams/1', GOOD)).status, 401);
    assert.strictEqual((await reqJson('DELETE', '/api/streams/1')).status, 401);
});

test('authenticated create returns 201 with the created row', async () => {
    const res = await reqJson('POST', '/api/streams', GOOD);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.folder, 'test_stream');
    assert.ok(Number.isInteger(res.body.id));
    assert.ok(res.body.created_at);

    const list = await reqJson('GET', '/api/streams');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.length, 1);
});

test('create rejects a bad folder (uppercase) with 400 {field:folder}', async () => {
    const res = await reqJson('POST', '/api/streams', { ...GOOD, folder: 'BAD CAPS' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'folder');
});

test('create rejects a non-ISO country with 400 {field:country}', async () => {
    const res = await reqJson('POST', '/api/streams', { ...GOOD, country: 'xx' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'country');
});

test('create rejects a non-url with 400 {field:url}', async () => {
    const res = await reqJson('POST', '/api/streams', { ...GOOD, url: 'not-a-url' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'url');
});

test('create rejects a duplicate folder with 409', async () => {
    const first = await reqJson('POST', '/api/streams', GOOD);
    assert.strictEqual(first.status, 201);
    const dup = await reqJson('POST', '/api/streams', {
        ...GOOD,
        name: 'Another',
    });
    assert.strictEqual(dup.status, 409);
});

test('PUT updates an existing stream', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    const res = await reqJson('PUT', `/api/streams/${created.id}`, {
        ...GOOD,
        name: 'Renamed',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, 'Renamed');
});

test('PUT an unknown id returns 404', async () => {
    const res = await reqJson('PUT', '/api/streams/999999', GOOD);
    assert.strictEqual(res.status, 404);
});

test('DELETE removes a stream; deleting an unknown id returns 404', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    const del = await reqJson('DELETE', `/api/streams/${created.id}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.ok, true);

    const missing = await reqJson('DELETE', `/api/streams/${created.id}`);
    assert.strictEqual(missing.status, 404);
});

// --- PUT /api/streams/reorder --------------------------------------------

function makeStream(suffix) {
    return reqJson('POST', '/api/streams', {
        country: 'NL',
        name: `Stream ${suffix}`,
        folder: `stream_${suffix}`,
        url: `https://example.com/${suffix}`,
    }).then((res) => res.body);
}

test('PUT /api/streams/reorder requires auth (401 anonymous)', async () => {
    authenticated = false;
    const res = await reqJson('PUT', '/api/streams/reorder', { order: [1] });
    assert.strictEqual(res.status, 401);
});

test('PUT /api/streams/reorder rejects an id-set mismatch with 400 {field:order}', async () => {
    const a = await makeStream('a');
    await makeStream('b');

    const res = await reqJson('PUT', '/api/streams/reorder', { order: [a.id] });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'order');
});

test('PUT /api/streams/reorder rejects a non-array order with 400 {field:order}', async () => {
    const res = await reqJson('PUT', '/api/streams/reorder', { order: 'nope' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'order');
});

test('PUT /api/streams/reorder persists the new order (subsequent GET reflects it)', async () => {
    const a = await makeStream('a');
    const b = await makeStream('b');
    const c = await makeStream('c');

    const res = await reqJson('PUT', '/api/streams/reorder', {
        order: [c.id, a.id, b.id],
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);

    const list = await reqJson('GET', '/api/streams');
    assert.deepStrictEqual(
        list.body.map((s) => s.id),
        [c.id, a.id, b.id]
    );
});

// --- PUT /api/app-config/default-stream + GET /api/app-config/public ------

test('PUT /api/app-config/default-stream requires auth (401 anonymous)', async () => {
    authenticated = false;
    const res = await reqJson('PUT', '/api/app-config/default-stream', {
        folder: 'stream_a',
    });
    assert.strictEqual(res.status, 401);
});

test('PUT /api/app-config/default-stream 400s on an unknown folder {field:folder}', async () => {
    const res = await reqJson('PUT', '/api/app-config/default-stream', {
        folder: 'does_not_exist',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'folder');
});

test('PUT /api/app-config/default-stream sets a valid folder; public config reflects it; empty clears it', async () => {
    await makeStream('a');

    const set = await reqJson('PUT', '/api/app-config/default-stream', {
        folder: 'stream_a',
    });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(set.body.default_stream_folder, 'stream_a');

    const pub = await reqJson('GET', '/api/app-config/public');
    assert.strictEqual(pub.status, 200);
    assert.strictEqual(pub.body.default_stream_folder, 'stream_a');

    const clear = await reqJson('PUT', '/api/app-config/default-stream', {
        folder: '',
    });
    assert.strictEqual(clear.status, 200);
    assert.strictEqual(clear.body.default_stream_folder, '');

    const pubAfter = await reqJson('GET', '/api/app-config/public');
    assert.strictEqual(pubAfter.body.default_stream_folder, '');
});
