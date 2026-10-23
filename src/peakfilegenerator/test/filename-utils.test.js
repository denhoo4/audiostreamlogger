const { test } = require('node:test');
const assert = require('node:assert');
const { extractFileDateTime } = require('../filename-utils');

test('extractFileDateTime returns the date-time stamp from a stream filename', () => {
    assert.strictEqual(extractFileDateTime('glowfm-2026-10-23-14'), '2026-10-23-14');
    assert.strictEqual(extractFileDateTime('rtvconnect-2026-01-01-00'), '2026-01-01-00');
});

test('extractFileDateTime returns null when there is no date-time stamp', () => {
    assert.strictEqual(extractFileDateTime('temp-export-123'), null);
    assert.strictEqual(extractFileDateTime('somefile-without-date'), null);
});
