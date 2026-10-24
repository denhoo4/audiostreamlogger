/**
 * Coverage for the OpenAPI docs surface (openapi/spec.js + openapi/docs.js):
 *
 *   1. A pure unit check that buildOpenApiDocument() returns a valid-shaped
 *      OpenAPI 3 document (openapi version 3.x, a paths object, and every
 *      documented route present) — guards against a route being dropped.
 *   2. An integration check of the mounted docs routes using the fake-session
 *      toggle + app.listen(0) + fetch pattern from streams-routes.test.js:
 *      anonymous GET /api/docs.json and /api/docs → 401; authenticated →
 *      200 with the spec JSON / Swagger UI HTML.
 *
 * No DB handle is needed: the spec module is pure and mountDocs only wires
 * requireAuth + swagger-ui-express.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { buildOpenApiDocument } = require('../openapi/spec');
const { mountDocs } = require('../openapi/docs');

// Routes that MUST be present in the generated document (a representative set
// spanning every tag + both param styles).
const REQUIRED_PATHS = [
    '/healthz',
    '/auth/login',
    '/auth/change-password',
    '/api/settings',
    '/api/streams',
    '/api/streams/{id}',
    '/api/jobs',
    '/api/jobs/schedules/{type}',
    '/api/jobs/config/log_retention',
    '/api/jobs/stream',
    '/api/analysis/summary',
    '/api/analysis/gaps',
    '/api/branding/favicon',
    '/api/backup/export',
    '/api/backup/db',
    '/api/backup/import',
    '/util/selection-export',
];

test('buildOpenApiDocument() returns a valid-shaped OpenAPI 3 document', () => {
    const doc = buildOpenApiDocument();
    assert.ok(
        typeof doc.openapi === 'string' && doc.openapi.startsWith('3.'),
        `expected openapi 3.x, got ${doc.openapi}`
    );
    assert.strictEqual(typeof doc.paths, 'object');
    assert.ok(Object.keys(doc.paths).length > 0, 'paths must be non-empty');
    for (const p of REQUIRED_PATHS) {
        assert.ok(doc.paths[p], `missing documented path: ${p}`);
    }
    // The session-cookie security scheme is declared and used by authed routes.
    assert.ok(
        doc.components &&
            doc.components.securitySchemes &&
            doc.components.securitySchemes.sessionCookie,
        'missing sessionCookie security scheme'
    );
    assert.ok(
        Array.isArray(doc.paths['/api/streams'].get.security),
        'GET /api/streams must declare security (authed)'
    );
    assert.strictEqual(
        doc.paths['/api/settings'].get.security,
        undefined,
        'GET /api/settings is public — no security'
    );
});

// --- integration: the mounted docs routes --------------------------------
let server;
let baseUrl;
let authenticated = false;

before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = authenticated ? { userId: 1, username: 'admin' } : {};
        next();
    });
    mountDocs(app);

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
});

test('anonymous GET /api/docs.json → 401', async () => {
    authenticated = false;
    const res = await fetch(`${baseUrl}/api/docs.json`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error, 'authentication required');
});

test('anonymous GET /api/docs → 401', async () => {
    authenticated = false;
    const res = await fetch(`${baseUrl}/api/docs`, { redirect: 'manual' });
    assert.strictEqual(res.status, 401);
});

test('authenticated GET /api/docs.json → 200 with the spec', async () => {
    authenticated = true;
    const res = await fetch(`${baseUrl}/api/docs.json`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    const doc = await res.json();
    assert.ok(doc.openapi.startsWith('3.'));
    for (const p of [
        '/api/streams',
        '/auth/login',
        '/api/jobs',
        '/api/analysis/gaps',
        '/api/backup/export',
    ]) {
        assert.ok(doc.paths[p], `missing documented path: ${p}`);
    }
});

test('authenticated GET /api/docs → 200 Swagger UI HTML', async () => {
    authenticated = true;
    const res = await fetch(`${baseUrl}/api/docs/`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.match(html, /swagger-ui/i);
});
