const { test } = require('node:test');
const assert = require('node:assert');
const { extractFileDateTime } = require('../filename-utils');

test('extractFileDateTime returns the YYYY-MM-DD-HH segment from a stamped filename', () => {
    assert.strictEqual(
        extractFileDateTime('radio1-2026-10-23-14'),
        '2026-10-23-14'
    );
    assert.strictEqual(
        extractFileDateTime('2026-01-02-09-extra'),
        '2026-01-02-09'
    );
});

test('extractFileDateTime returns null when there is no date pattern', () => {
    assert.strictEqual(extractFileDateTime('no-date-here'), null);
    assert.strictEqual(extractFileDateTime(''), null);
});
