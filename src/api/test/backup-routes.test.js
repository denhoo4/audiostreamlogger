/**
 * Integration coverage for the /api/backup router (routes/backup.js): export +
 * import behind requireAuth, with the SAFETY guarantee that a backup carries
 * ONLY streams + allowlisted app_config — never users/sessions.
 *
 * Reuses the FEAT-001 temp-DB injection + fake-session ephemeral-server pattern.
 * The pure validator/allowlist logic lives in backup.test.js; this suite proves
 * the mounted router's status codes, the auth gate, and the users/sessions
 * exclusion end to end.
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
let streamsSvc;
let appConfig;
let server;
let baseUrl;
let authenticated = true;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-backuproutes-'));
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
    appConfig = require('../services/app-config');

    const backupRouter = require('../routes/backup');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = authenticated ? { userId: 1, username: 'admin' } : {};
        next();
    });
    app.use('/api/backup', backupRouter);

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
    db.exec('DELETE FROM app_config');
    db.exec('DELETE FROM users');
});

function req(method, pathname, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    return fetch(`${baseUrl}${pathname}`, opts);
}

async function reqJson(method, pathname, body) {
    const res = await req(method, pathname, body);
    return { status: res.status, body: await res.json().catch(() => undefined) };
}

test('export + import are 401 when anonymous', async () => {
    authenticated = false;
    assert.strictEqual((await reqJson('GET', '/api/backup/export')).status, 401);
    assert.strictEqual(
        (await reqJson('POST', '/api/backup/import', { version: 1, streams: [] })).status,
        401
    );
});

test('authenticated export returns streams + safe config only (no users/sessions)', async () => {
    streamsSvc.createStream({
        country: 'NL',
        name: 'Exported',
        folder: 'exported',
        url: 'https://example.com/exported',
        codec: 'opus',
        bitrate_kbps: 128,
    });
    appConfig.setConfig('app_title', 'My Logger');
    appConfig.setConfig('log_retention', '48');
    // Seed a user row so we can prove it never crosses into the export.
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
        'admin',
        'secret-hash'
    );

    const res = await req('GET', '/api/backup/export');
    assert.strictEqual(res.status, 200);
    assert.match(
        res.headers.get('content-disposition') || '',
        /attachment; filename="audiostreamlogger-backup-/
    );

    const backup = await res.json();
    assert.strictEqual(backup.version, 1);
    assert.strictEqual(backup.streams.length, 1);
    // Stream carries the public fields incl. the per-stream quality fields.
    assert.deepStrictEqual(
        Object.keys(backup.streams[0]).sort(),
        ['bit_depth', 'bitrate_kbps', 'codec', 'country', 'folder', 'name', 'url']
    );
    assert.strictEqual(backup.streams[0].codec, 'opus');
    assert.strictEqual(backup.streams[0].bitrate_kbps, 128);
    assert.strictEqual(backup.streams[0].bit_depth, null);
    assert.strictEqual(backup.app_config.app_title, 'My Logger');

    // The whole serialized backup must contain no user/session material.
    const serialized = JSON.stringify(backup);
    assert.ok(!('users' in backup), 'no users key');
    assert.ok(!('sessions' in backup), 'no sessions key');
    assert.ok(!serialized.includes('secret-hash'), 'no password hash leaked');
});

test('authenticated import upserts streams, applies safe config, reports counts', async () => {
    // Pre-seed one stream the import will UPDATE by folder.
    streamsSvc.createStream({
        country: 'NL',
        name: 'Old',
        folder: 'existing',
        url: 'https://old.example.com',
    });

    const res = await reqJson('POST', '/api/backup/import', {
        version: 1,
        streams: [
            {
                country: 'BE',
                name: 'New',
                folder: 'existing',
                url: 'https://new.example.com',
            },
            {
                country: 'NL',
                name: 'Fresh',
                folder: 'fresh',
                url: 'https://fresh.example.com',
            },
            // invalid -> skipped (not applied)
            {
                country: 'NL',
                name: 'Broken',
                folder: 'BAD CAPS',
                url: 'https://x.example.com',
            },
        ],
        app_config: {
            app_title: 'Imported Title',
            favicon_path: '/should/be/dropped',
        },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.imported, 1);
    assert.strictEqual(res.body.updated, 1);
    assert.strictEqual(res.body.skipped.length, 1);
    assert.strictEqual(res.body.skipped[0].folder, 'BAD CAPS');
    assert.ok(res.body.config_applied.includes('app_title'));
    assert.ok(!res.body.config_applied.includes('favicon_path'));

    // The existing stream was updated in place; safe config persisted.
    assert.strictEqual(streamsSvc.getStreamByFolder('existing').name, 'New');
    assert.strictEqual(appConfig.getConfig('app_title'), 'Imported Title');
    assert.strictEqual(appConfig.getConfig('favicon_path'), undefined);
});

test('import preserves per-stream quality and a pre-feature entry imports as mp3 default (AC-12)', async () => {
    const res = await reqJson('POST', '/api/backup/import', {
        version: 1,
        streams: [
            // explicit quality -> preserved
            {
                country: 'NL',
                name: 'Flac Stream',
                folder: 'flac_stream',
                url: 'https://example.com/flac',
                codec: 'flac',
                bit_depth: 24,
            },
            // pre-feature entry (no quality fields) -> mp3 default
            {
                country: 'BE',
                name: 'Legacy Stream',
                folder: 'legacy_stream',
                url: 'https://example.com/legacy',
            },
        ],
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.imported, 2);

    const flac = streamsSvc.getStreamByFolder('flac_stream');
    assert.strictEqual(flac.codec, 'flac');
    assert.strictEqual(flac.bit_depth, 24);
    assert.strictEqual(flac.bitrate_kbps, null);

    const legacy = streamsSvc.getStreamByFolder('legacy_stream');
    assert.strictEqual(legacy.codec, 'mp3');
    assert.strictEqual(legacy.bitrate_kbps, 160);
    assert.strictEqual(legacy.bit_depth, null);
});

test('import skips-and-reports an invalid quality combo (flac+bitrate)', async () => {
    const res = await reqJson('POST', '/api/backup/import', {
        version: 1,
        streams: [
            {
                country: 'NL',
                name: 'Bad Quality',
                folder: 'bad_quality',
                url: 'https://example.com/bad',
                codec: 'flac',
                bit_depth: 16,
                bitrate_kbps: 128,
            },
        ],
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.imported, 0);
    assert.strictEqual(res.body.skipped.length, 1);
    assert.strictEqual(res.body.skipped[0].folder, 'bad_quality');
    assert.strictEqual(streamsSvc.getStreamByFolder('bad_quality'), undefined);
});

test('import of a malformed body (bad version) returns 400', async () => {
    const res = await reqJson('POST', '/api/backup/import', {
        version: 2,
        streams: [],
    });
    assert.strictEqual(res.status, 400);
});

test('GET /api/backup/db 404s when the fixed DB path is absent', async () => {
    // The route reads a hardcoded /usr/src/app/data/app.db which does not exist
    // in the test environment, so it legitimately 404s (not 500).
    const res = await reqJson('GET', '/api/backup/db');
    assert.strictEqual(res.status, 404);
});
