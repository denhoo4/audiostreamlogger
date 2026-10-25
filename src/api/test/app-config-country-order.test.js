/**
 * Coverage for the country_order validateConfig/setConfig branch + the
 * parseCountryOrder helper (FEAT-001). Uses the temp-DB require.cache injection
 * pattern so setConfig writes to a throwaway DB. The stored value is a JSON
 * string array of ISO alpha-2 codes; the ROUTE normalises to uppercase before
 * calling setConfig, so here we round-trip an already-uppercased JSON string
 * and assert parseCountryOrder's defensive behaviour on absent/malformed input.
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-countryorder-'));
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
    db.exec("DELETE FROM app_config WHERE key = 'country_order'");
});

test('setConfig round-trips a JSON array of codes via parseCountryOrder', () => {
    const stored = appConfig.setConfig(
        'country_order',
        JSON.stringify(['NL', 'BE'])
    );
    assert.strictEqual(stored, '["NL","BE"]');
    assert.deepStrictEqual(
        appConfig.parseCountryOrder(appConfig.getConfig('country_order')),
        ['NL', 'BE']
    );
});

test('a lowercase code passes validation and parseCountryOrder returns it verbatim (route uppercases)', () => {
    // validateConfig accepts two-letter codes regardless of case; normalisation
    // to uppercase is the ROUTE's job (it JSON.stringifies codes.map(toUpperCase)
    // before setConfig). This asserts the service stores exactly what it is given.
    appConfig.setConfig('country_order', JSON.stringify(['nl', 'be']));
    assert.deepStrictEqual(
        appConfig.parseCountryOrder(appConfig.getConfig('country_order')),
        ['nl', 'be']
    );
});

test('setConfig rejects a non-array value with ConfigValidationError {field:country_order}', () => {
    assert.throws(
        () => appConfig.setConfig('country_order', JSON.stringify('NL')),
        (err) => {
            assert.ok(err instanceof appConfig.ConfigValidationError);
            assert.strictEqual(err.field, 'country_order');
            return true;
        }
    );
});

test('setConfig rejects an array with a bad element with ConfigValidationError {field:country_order}', () => {
    assert.throws(
        () => appConfig.setConfig('country_order', JSON.stringify(['NL', 'XYZ'])),
        (err) => {
            assert.ok(err instanceof appConfig.ConfigValidationError);
            assert.strictEqual(err.field, 'country_order');
            return true;
        }
    );
});

test('parseCountryOrder(undefined) returns []', () => {
    assert.deepStrictEqual(appConfig.parseCountryOrder(undefined), []);
});

test('parseCountryOrder("not json") returns []', () => {
    assert.deepStrictEqual(appConfig.parseCountryOrder('not json'), []);
});
