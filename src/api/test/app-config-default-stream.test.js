/**
 * Coverage for the default_stream_folder validateConfig/setConfig branch
 * (FEAT-001). Uses the temp-DB require.cache injection pattern so setConfig
 * writes to a throwaway DB. The branch accepts any string (including the empty
 * string = "no default") and rejects a non-string with ConfigValidationError
 * whose field === 'default_stream_folder'.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let tmpDir;
let db;
let appConfig;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-defaultstream-'));
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

beforeEach(() => {
    db.exec("DELETE FROM app_config WHERE key = 'default_stream_folder'");
});

test('setConfig accepts a non-empty default_stream_folder string', () => {
    const stored = appConfig.setConfig('default_stream_folder', 'radio1');
    assert.strictEqual(stored, 'radio1');
    assert.strictEqual(appConfig.getConfig('default_stream_folder'), 'radio1');
});

test('setConfig accepts the empty string (clears the default)', () => {
    const stored = appConfig.setConfig('default_stream_folder', '');
    assert.strictEqual(stored, '');
    assert.strictEqual(appConfig.getConfig('default_stream_folder'), '');
});

test('setConfig rejects a non-string with ConfigValidationError {field:default_stream_folder}', () => {
    assert.throws(
        () => appConfig.setConfig('default_stream_folder', 123),
        (err) => {
            assert.ok(err instanceof appConfig.ConfigValidationError);
            assert.strictEqual(err.field, 'default_stream_folder');
            return true;
        }
    );
});
