const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const {
    SAFE_CONFIG_KEYS,
    BACKUP_VERSION,
    buildBackup,
    pickSafeConfig,
    validateBackup,
} = require('../lib/backup');

const GOOD_STREAM = {
    country: 'NL',
    name: 'Test Stream',
    folder: 'test_stream',
    url: 'https://example.com/stream',
};

// --- buildBackup ----------------------------------------------------------

test('buildBackup shapes version, exported_at, streams and filtered config', () => {
    const backup = buildBackup({
        streams: [{ ...GOOD_STREAM, id: 7, created_at: 'x', updated_at: 'y' }],
        config: {
            app_title: 'My Logger',
            log_retention: '2',
            favicon_path: '/usr/src/app/data/branding/favicon.png',
            some_secret: 'leak',
        },
        exported_at: '2026-10-23T00:00:00.000Z',
    });

    assert.strictEqual(backup.version, BACKUP_VERSION);
    assert.strictEqual(backup.exported_at, '2026-10-23T00:00:00.000Z');
    // Only the four public stream fields, dropping id/timestamps.
    assert.deepStrictEqual(backup.streams, [GOOD_STREAM]);
    // Safe keys kept; favicon_path + unknown secret dropped.
    assert.deepStrictEqual(backup.app_config, {
        app_title: 'My Logger',
        log_retention: '2',
    });
});

test('buildBackup defaults streams to [] and sets an ISO exported_at when omitted', () => {
    const backup = buildBackup({});
    assert.deepStrictEqual(backup.streams, []);
    assert.deepStrictEqual(backup.app_config, {});
    assert.ok(!Number.isNaN(Date.parse(backup.exported_at)));
});

// --- pickSafeConfig -------------------------------------------------------

test('pickSafeConfig keeps only allowlisted keys', () => {
    const picked = pickSafeConfig({
        app_title: 'T',
        log_retention: '2',
        recorder_minute: '0',
        output_retention_count: '100',
        favicon_path: '/x',
        favicon_mime: 'image/png',
        worker_status: 'idle',
        some_secret: 'nope',
    });
    assert.deepStrictEqual(Object.keys(picked).sort(), [...SAFE_CONFIG_KEYS].sort());
    assert.ok(!('favicon_path' in picked));
    assert.ok(!('some_secret' in picked));
});

test('pickSafeConfig tolerates a missing/non-object config', () => {
    assert.deepStrictEqual(pickSafeConfig(undefined), {});
    assert.deepStrictEqual(pickSafeConfig(null), {});
    assert.deepStrictEqual(pickSafeConfig('nope'), {});
});

// --- validateBackup -------------------------------------------------------

test('validateBackup accepts a well-formed backup with a good stream', () => {
    const result = validateBackup({
        version: 1,
        streams: [GOOD_STREAM],
        app_config: { app_title: 'T' },
    });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.streams.length, 1);
    assert.strictEqual(result.streams[0].valid, true);
});

test('validateBackup rejects a wrong version', () => {
    const result = validateBackup({ version: 2, streams: [] });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => /version/.test(e)));
});

test('validateBackup rejects a non-array streams and a non-object app_config', () => {
    const r1 = validateBackup({ version: 1, streams: 'nope' });
    assert.strictEqual(r1.ok, false);
    assert.ok(r1.errors.some((e) => /streams must be an array/.test(e)));

    const r2 = validateBackup({ version: 1, streams: [], app_config: [] });
    assert.strictEqual(r2.ok, false);
    assert.ok(r2.errors.some((e) => /app_config must be an object/.test(e)));
});

test('validateBackup flags a per-stream failure (bad folder/country/url) without rejecting the whole backup', () => {
    const result = validateBackup({
        version: 1,
        streams: [
            GOOD_STREAM,
            { country: 'NL', name: 'Bad', folder: 'BAD CAPS', url: 'https://x' },
            { country: 'xx', name: 'Bad2', folder: 'ok', url: 'https://x' },
            { country: 'NL', name: 'Bad3', folder: 'ok3', url: 'not-a-url' },
        ],
    });
    // Top-level shape is fine, so ok is true; per-stream validity is reported.
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.streams[0].valid, true);
    assert.strictEqual(result.streams[1].valid, false);
    assert.strictEqual(result.streams[1].error, 'invalid folder');
    assert.strictEqual(result.streams[2].valid, false);
    assert.strictEqual(result.streams[2].error, 'invalid country');
    assert.strictEqual(result.streams[3].valid, false);
    assert.strictEqual(result.streams[3].error, 'invalid url');
});

// --- temp-DB integration: import upsert-by-folder + skipped reporting -----
// services/streams.js + app-config.js require('../db'); inject a temp handle
// into the module cache before requiring them (see jobs-schema.test.js).

let tmpDir;
let db;
let streamsSvc;
let appConfig;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-backup-'));
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

    const { applySchema } = require('../db/schema');
    applySchema(db);

    streamsSvc = require('../services/streams');
    appConfig = require('../services/app-config');
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('import upserts by folder: creates new, updates existing, applies safe config', () => {
    // Seed an existing stream that the import will UPDATE by folder.
    streamsSvc.createStream({
        country: 'NL',
        name: 'Old Name',
        folder: 'existing',
        url: 'https://old.example.com',
    });

    const backup = {
        version: 1,
        streams: [
            {
                country: 'BE',
                name: 'New Name',
                folder: 'existing',
                url: 'https://new.example.com',
            },
            {
                country: 'NL',
                name: 'Fresh',
                folder: 'fresh',
                url: 'https://fresh.example.com',
            },
            // invalid -> skipped
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
            log_retention: '999999', // out of range -> config_skipped
        },
    };

    // Mirror the route logic over the pure validator + services.
    const { ok, streams } = validateBackup(backup);
    assert.strictEqual(ok, true);

    let imported = 0;
    let updated = 0;
    const skipped = [];
    for (const entry of streams) {
        const s = entry.stream;
        if (!entry.valid) {
            skipped.push({ folder: s.folder, reason: entry.error });
            continue;
        }
        const existing = streamsSvc.getStreamByFolder(s.folder);
        if (existing) {
            streamsSvc.updateStream(existing.id, s);
            updated += 1;
        } else {
            streamsSvc.createStream(s);
            imported += 1;
        }
    }

    const config_applied = [];
    const config_skipped = [];
    for (const [key, value] of Object.entries(pickSafeConfig(backup.app_config))) {
        try {
            appConfig.setConfig(key, value);
            config_applied.push(key);
        } catch (err) {
            config_skipped.push({ key, reason: err.message });
        }
    }

    assert.strictEqual(imported, 1, 'one new stream created');
    assert.strictEqual(updated, 1, 'one existing stream updated by folder');
    assert.strictEqual(skipped.length, 1, 'one invalid stream skipped');
    assert.strictEqual(skipped[0].folder, 'BAD CAPS');

    // The existing stream was mutated in place (same folder, new fields).
    const existing = streamsSvc.getStreamByFolder('existing');
    assert.strictEqual(existing.name, 'New Name');
    assert.strictEqual(existing.country, 'BE');

    // favicon_path never crosses the allowlist; out-of-range retention skipped.
    assert.ok(config_applied.includes('app_title'));
    assert.ok(!config_applied.includes('favicon_path'));
    assert.ok(config_skipped.some((c) => c.key === 'log_retention'));
    assert.strictEqual(appConfig.getConfig('app_title'), 'Imported Title');
    assert.strictEqual(appConfig.getConfig('favicon_path'), undefined);
});
