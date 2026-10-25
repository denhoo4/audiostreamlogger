/**
 * Integration coverage for the country_order endpoints on the /api router
 * (routes/api.js): the PUBLIC read on GET /api/app-config/public plus the
 * authed setter PUT /api/app-config/country-order (FEAT-001).
 *
 * Uses the temp-DB require.cache injection + ephemeral express.listen(0)
 * pattern (settings-routes.test.js) with the fake-session toggle from
 * openapi-docs.test.js so requireAuth sees an authenticated session only when
 * we flip `authenticated` on. The public read needs no session; the setter
 * returns 401 when anonymous.
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
let authenticated = false;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-countryorder-routes-'));
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
    // Fake session middleware: requireAuth reads req.session.userId.
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
    authenticated = false;
    db.exec("DELETE FROM app_config WHERE key = 'country_order'");
});

function getJson(pathname) {
    return fetch(`${baseUrl}${pathname}`).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => undefined),
    }));
}

function putJson(pathname, payload) {
    return fetch(`${baseUrl}${pathname}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => undefined),
    }));
}

test('GET /api/app-config/public is public and includes country_order (array)', async () => {
    const res = await getJson('/api/app-config/public');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.country_order));
    assert.deepStrictEqual(res.body.country_order, []);
});

test('authed PUT /api/app-config/country-order {codes} -> 200 and the public GET reflects it', async () => {
    authenticated = true;
    const put = await putJson('/api/app-config/country-order', {
        codes: ['NL', 'BE'],
    });
    assert.strictEqual(put.status, 200);
    assert.deepStrictEqual(put.body, { country_order: ['NL', 'BE'] });

    authenticated = false;
    const pub = await getJson('/api/app-config/public');
    assert.strictEqual(pub.status, 200);
    assert.deepStrictEqual(pub.body.country_order, ['NL', 'BE']);
});

test('PUT /api/app-config/country-order uppercases lowercase codes', async () => {
    authenticated = true;
    const put = await putJson('/api/app-config/country-order', {
        codes: ['nl', 'be'],
    });
    assert.strictEqual(put.status, 200);
    assert.deepStrictEqual(put.body, { country_order: ['NL', 'BE'] });
});

test('anonymous PUT /api/app-config/country-order -> 401', async () => {
    authenticated = false;
    const put = await putJson('/api/app-config/country-order', {
        codes: ['NL'],
    });
    assert.strictEqual(put.status, 401);
});

test('PUT with codes not an array -> 400 {field:country_order}', async () => {
    authenticated = true;
    const put = await putJson('/api/app-config/country-order', { codes: 'NL' });
    assert.strictEqual(put.status, 400);
    assert.strictEqual(put.body.field, 'country_order');
});

test('PUT with a bad code element -> 400 {field:country_order}', async () => {
    authenticated = true;
    const put = await putJson('/api/app-config/country-order', {
        codes: ['NL', 'XYZ'],
    });
    assert.strictEqual(put.status, 400);
    assert.strictEqual(put.body.field, 'country_order');
});
