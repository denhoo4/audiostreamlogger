/**
 * Integration coverage for the /api/analysis router (routes/analysis.js):
 * summary + gaps, EVERYTHING behind requireAuth (no public analysis surface).
 *
 * Reuses the FEAT-001 temp-DB injection + fake-session ephemeral-server pattern.
 * A few recordings rows are seeded via the service's upsertRecording(handle,...)
 * so the summary/gaps shapes are exercised against real data. The pure analysis
 * helpers themselves are covered by recordings.test.js; this suite proves the
 * HTTP wiring, the auth gate, and the validation branches.
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
let server;
let baseUrl;
let authenticated = true;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-analysisroutes-'));
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
    const recordings = require('../services/recordings');

    // Seed two hour-slots for one folder on 2026-01-01 (00 + 01), leaving the
    // rest of that day missing so the gaps shape has a known present/missing mix.
    recordings.upsertRecording(db, {
        stream_folder: 'nl_one',
        date: '2026-01-01',
        hour: '00',
        file_path: '/audio/nl_one/nl_one-2026-01-01-00.mp3',
        status: 'complete',
        duration_seconds: 3600,
        size_bytes: 1000,
        segment_count: 1,
    });
    recordings.upsertRecording(db, {
        stream_folder: 'nl_one',
        date: '2026-01-01',
        hour: '01',
        file_path: '/audio/nl_one/nl_one-2026-01-01-01.mp3',
        status: 'complete',
        duration_seconds: 3600,
        size_bytes: 2000,
        segment_count: 1,
    });

    const analysisRouter = require('../routes/analysis');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = authenticated ? { userId: 1, username: 'admin' } : {};
        next();
    });
    app.use('/api/analysis', analysisRouter);

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

test('summary + gaps are 401 when anonymous', async () => {
    authenticated = false;
    assert.strictEqual((await getJson('/api/analysis/summary')).status, 401);
    assert.strictEqual(
        (await getJson('/api/analysis/gaps?folder=nl_one&start=2026-01-01&end=2026-01-01')).status,
        401
    );
    authenticated = true;
});

test('authenticated summary returns {per_stream, overall}', async () => {
    authenticated = true;
    const res = await getJson('/api/analysis/summary');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.per_stream));
    assert.ok(res.body.overall);
    assert.strictEqual(res.body.per_stream.length, 1);
    assert.strictEqual(res.body.per_stream[0].stream_folder, 'nl_one');
    assert.strictEqual(res.body.per_stream[0].recording_count, 2);
    assert.strictEqual(res.body.overall.storage_bytes, 3000);
    assert.strictEqual(res.body.overall.stream_count, 1);
});

test('gaps requires folder (400 {field:folder})', async () => {
    authenticated = true;
    const res = await getJson('/api/analysis/gaps?start=2026-01-01&end=2026-01-01');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'folder');
});

test('gaps rejects a bad date with 400 {field:start}', async () => {
    authenticated = true;
    const res = await getJson(
        '/api/analysis/gaps?folder=nl_one&start=not-a-date&end=2026-01-01'
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'start');
});

test('gaps rejects start > end with 400 {field:start}', async () => {
    authenticated = true;
    const res = await getJson(
        '/api/analysis/gaps?folder=nl_one&start=2026-01-02&end=2026-01-01'
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'start');
});

test('gaps returns the documented shape on success', async () => {
    authenticated = true;
    const res = await getJson(
        '/api/analysis/gaps?folder=nl_one&start=2026-01-01&end=2026-01-01'
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.folder, 'nl_one');
    assert.strictEqual(res.body.expected_count, 24); // one full day
    assert.strictEqual(res.body.present_count, 2); // seeded hours 00 + 01
    assert.strictEqual(res.body.missing.length, 22);
    assert.ok(Math.abs(res.body.coverage_ratio - 2 / 24) < 1e-9);
    // Each missing entry carries {date, hour}.
    assert.deepStrictEqual(
        Object.keys(res.body.missing[0]).sort(),
        ['date', 'hour']
    );
});
