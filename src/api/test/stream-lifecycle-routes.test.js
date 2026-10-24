/**
 * HTTP wiring for the stream-folder lifecycle routes (routes/api.js) — TODO
 * items 25 (DELETE folder) + 26 (RENAME folder on PUT). Reuses the temp-DB
 * injection + ephemeral-server pattern from streams-routes.test.js and points
 * AUDIO_DIR at a THROWAWAY temp dir so the DELETE/PUT fs ops run on disk without
 * touching the production ./audio. The deeper unit behaviour (ordering,
 * stamp-anchored rebuild, reconcile no-op, crash recovery) lives in
 * stream-lifecycle.test.js; this suite proves the status codes + error shapes.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let rootTmp;
let audioDir;
let db;
let server;
let baseUrl;
let authenticated = true;
let amsterdamSlot;

before(async () => {
    rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-lifecycle-routes-'));
    audioDir = path.join(rootTmp, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    process.env.AUDIO_DIR = audioDir;

    const dbPath = path.join(rootTmp, 'app.db');
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
    ({ amsterdamSlot } = require('../lib/amsterdam-slot'));

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
            baseUrl = `http://127.0.0.1:${server.address().port}`;
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
    fs.rmSync(rootTmp, { recursive: true, force: true });
    delete process.env.AUDIO_DIR;
});

beforeEach(() => {
    authenticated = true;
    db.exec('DELETE FROM streams');
    db.exec('DELETE FROM recordings');
    for (const entry of fs.readdirSync(audioDir)) {
        fs.rmSync(path.join(audioDir, entry), { recursive: true, force: true });
    }
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
    name: 'Radio One',
    folder: 'radio_one',
    url: 'https://example.com/one',
};

function writeFile(folder, name, bytes = 10) {
    const dir = path.join(audioDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.alloc(bytes, 1));
}

function insertRecording(folder, date, hour, status) {
    const name = `${folder}-${date}-${hour}.mp3`;
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES (?, ?, ?, ?, ?, 1)`
    ).run(folder, date, hour, path.join(audioDir, folder, name), status);
}

/* ----- deletion-impact ----- */

test('GET deletion-impact requires auth (401 anonymous)', async () => {
    authenticated = false;
    const res = await reqJson('GET', '/api/streams/1/deletion-impact');
    assert.strictEqual(res.status, 401);
});

test('GET deletion-impact 404s on an unknown id', async () => {
    const res = await reqJson('GET', '/api/streams/999999/deletion-impact');
    assert.strictEqual(res.status, 404);
});

test('GET deletion-impact returns an advisory file/byte count', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    writeFile('radio_one', 'radio_one-2026-10-23-09.mp3', 123);
    const res = await reqJson('GET', `/api/streams/${created.id}/deletion-impact`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.folder, 'radio_one');
    assert.strictEqual(res.body.fileCount, 1);
    assert.strictEqual(res.body.totalBytes, 123);
});

/* ----- DELETE ----- */

test('DELETE removes the stream + its folder (200 ok)', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    writeFile('radio_one', 'radio_one-2026-10-23-09.mp3');
    insertRecording('radio_one', '2026-10-23', '09', 'complete');

    const del = await reqJson('DELETE', `/api/streams/${created.id}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.ok, true);
    assert.strictEqual(fs.existsSync(path.join(audioDir, 'radio_one')), false);
    assert.strictEqual(
        db.prepare("SELECT COUNT(*) c FROM recordings WHERE stream_folder='radio_one'").get().c,
        0
    );
});

test('DELETE returns 409 when recording the current hour-slot', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    const slot = amsterdamSlot(new Date());
    insertRecording('radio_one', slot.date, slot.hour, 'recording');

    const del = await reqJson('DELETE', `/api/streams/${created.id}`);
    assert.strictEqual(del.status, 409);
    // The stream is NOT removed.
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM streams').get().c, 1);
});

test('DELETE unknown id returns 404', async () => {
    const res = await reqJson('DELETE', '/api/streams/999999');
    assert.strictEqual(res.status, 404);
});

/* ----- RENAME via PUT ----- */

test('PUT changing folder moves files + re-points rows (200)', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    writeFile('radio_one', 'radio_one-2026-10-23-09.mp3');
    insertRecording('radio_one', '2026-10-23', '09', 'complete');

    const res = await reqJson('PUT', `/api/streams/${created.id}`, {
        ...GOOD,
        folder: 'radio_new',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.folder, 'radio_new');
    assert.ok(fs.existsSync(path.join(audioDir, 'radio_new', 'radio_new-2026-10-23-09.mp3')));
    assert.strictEqual(fs.existsSync(path.join(audioDir, 'radio_one')), false);
    const row = db.prepare('SELECT stream_folder, file_path FROM recordings').get();
    assert.strictEqual(row.stream_folder, 'radio_new');
    assert.strictEqual(
        row.file_path,
        path.join(audioDir, 'radio_new', 'radio_new-2026-10-23-09.mp3')
    );
});

test('PUT changing folder returns 409 when recording the current hour', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    const slot = amsterdamSlot(new Date());
    insertRecording('radio_one', slot.date, slot.hour, 'recording');

    const res = await reqJson('PUT', `/api/streams/${created.id}`, {
        ...GOOD,
        folder: 'radio_new',
    });
    assert.strictEqual(res.status, 409);
    // Folder unchanged.
    assert.strictEqual(
        db.prepare('SELECT folder FROM streams WHERE id = ?').get(created.id).folder,
        'radio_one'
    );
});

test('PUT changing folder to an existing on-disk folder returns 400', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    writeFile('taken', 'taken-2026-10-23-09.mp3');

    const res = await reqJson('PUT', `/api/streams/${created.id}`, {
        ...GOOD,
        folder: 'taken',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'folder');
});

test('PUT NOT changing folder still updates other fields (no rename path)', async () => {
    const created = (await reqJson('POST', '/api/streams', GOOD)).body;
    const res = await reqJson('PUT', `/api/streams/${created.id}`, {
        ...GOOD,
        name: 'Renamed Name',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.name, 'Renamed Name');
    assert.strictEqual(res.body.folder, 'radio_one');
});
