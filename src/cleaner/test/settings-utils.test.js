const { test } = require('node:test');
const assert = require('node:assert');
const { validateMinute, validateRetentionHours } = require('../settings-utils');

test('validateMinute accepts the boundary values 0 and 59', () => {
    assert.strictEqual(validateMinute('cleaner_minute', 0).ok, true);
    assert.strictEqual(validateMinute('cleaner_minute', 59).ok, true);
});

test('validateMinute rejects out-of-range and non-integer values', () => {
    assert.strictEqual(validateMinute('cleaner_minute', -1).ok, false);
    assert.strictEqual(validateMinute('cleaner_minute', 60).ok, false);
    assert.strictEqual(validateMinute('cleaner_minute', 1.5).ok, false);
    assert.strictEqual(validateMinute('cleaner_minute', 'x').ok, false);
});

test('validateRetentionHours accepts 1, 168 and 8760', () => {
    assert.strictEqual(validateRetentionHours(1).ok, true);
    assert.strictEqual(validateRetentionHours(168).ok, true);
    assert.strictEqual(validateRetentionHours(8760).ok, true);
});

test('validateRetentionHours rejects out-of-range and non-integer values', () => {
    assert.strictEqual(validateRetentionHours(0).ok, false);
    assert.strictEqual(validateRetentionHours(9000).ok, false);
    assert.strictEqual(validateRetentionHours(1.5).ok, false);
    assert.strictEqual(validateRetentionHours('x').ok, false);
});
