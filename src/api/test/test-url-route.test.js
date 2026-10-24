/**
 * Integration coverage for POST /api/streams/test-url (routes/api.js): the
 * advisory reachability probe behind requireAuth. Reuses the temp-DB injection
 * + fake-session + app.listen(0) + fetch pattern from streams-routes.test.js.
 *
 * The real probe (lib/probe-stream-url.js) is OVERRIDDEN in require.cache before
 * the router is required, so NO real network is hit — the route wiring (auth,
 * body handling, result shape, ProbeInputError → 400) is what's under test here
 * (the probe's own classification is covered by probe-stream-url.test.js).
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

// Controls the injected fake probe's behaviour per-test.
let probeImpl;

// Reuse the real ProbeInputError so `instanceof` in the route behaves exactly
// as in production.
const { ProbeInputError } = require('../lib/probe-stream-url');

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-testurl-'));
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

    // Override the probe module BEFORE the router requires it, so no real
    // network call is ever made. `probeStreamUrl` delegates to the per-test
    // `probeImpl`; ProbeInputError stays the real class for instanceof.
    const probeModulePath = require.resolve('../lib/probe-stream-url');
    require.cache[probeModulePath] = {
        id: probeModulePath,
        filename: probeModulePath,
        loaded: true,
        exports: {
            probeStreamUrl: (url) => probeImpl(url),
            ProbeInputError,
        },
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
    probeImpl = async () => ({ reachable: true, status: 200, detail: 'reachable audio stream' });
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

test('POST /api/streams/test-url requires auth (401 anonymous)', async () => {
    authenticated = false;
    const res = await reqJson('POST', '/api/streams/test-url', {
        url: 'https://example.com/stream',
    });
    assert.strictEqual(res.status, 401);
});

test('authenticated + reachable probe → 200 with the result shape', async () => {
    probeImpl = async () => ({
        reachable: true,
        status: 200,
        contentType: 'audio/mpeg',
        detail: 'reachable audio stream',
    });
    const res = await reqJson('POST', '/api/streams/test-url', {
        url: 'https://example.com/stream',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reachable, true);
    assert.strictEqual(res.body.status, 200);
    assert.strictEqual(res.body.contentType, 'audio/mpeg');
    assert.strictEqual(typeof res.body.detail, 'string');
});

test('authenticated + not-reachable probe → 200 with reachable:false + detail', async () => {
    probeImpl = async () => ({ reachable: false, status: 404, detail: 'server returned HTTP 404' });
    const res = await reqJson('POST', '/api/streams/test-url', {
        url: 'https://example.com/missing',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reachable, false);
    assert.match(res.body.detail, /HTTP 404/);
});

test('authenticated + malformed url (ProbeInputError) → 400 {field:url}', async () => {
    probeImpl = async () => {
        throw new ProbeInputError('invalid url');
    };
    const res = await reqJson('POST', '/api/streams/test-url', { url: 'not-a-url' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'url');
});

test('authenticated + unexpected probe throw → 200 advisory {reachable:false}', async () => {
    probeImpl = async () => {
        throw new Error('boom');
    };
    const res = await reqJson('POST', '/api/streams/test-url', {
        url: 'https://example.com/stream',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reachable, false);
    assert.strictEqual(res.body.detail, 'probe failed');
});
