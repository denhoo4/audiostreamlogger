const { test } = require('node:test');
const assert = require('node:assert');
const {
    validateRetentionHours,
    parseOutputRetentionCount,
} = require('../lib/config-validate');

test('validateRetentionHours accepts the in-bounds values at and within the 1..8760 edges', () => {
    assert.deepStrictEqual(validateRetentionHours(1), { ok: true });
    assert.deepStrictEqual(validateRetentionHours(2), { ok: true });
    assert.deepStrictEqual(validateRetentionHours(8760), { ok: true });
});

test('validateRetentionHours rejects out-of-bounds and non-integer values', () => {
    assert.strictEqual(validateRetentionHours(0).ok, false);
    assert.strictEqual(validateRetentionHours(-1).ok, false);
    assert.strictEqual(validateRetentionHours(8761).ok, false);
    assert.strictEqual(validateRetentionHours(2.5).ok, false);
    assert.strictEqual(validateRetentionHours(NaN).ok, false);
});

test('parseOutputRetentionCount returns the positive integer for valid input', () => {
    assert.strictEqual(parseOutputRetentionCount('100'), 100);
    assert.strictEqual(parseOutputRetentionCount('1'), 1);
    assert.strictEqual(parseOutputRetentionCount(250), 250);
});

test('parseOutputRetentionCount falls back to 100 on missing/invalid/non-positive input', () => {
    assert.strictEqual(parseOutputRetentionCount(undefined), 100);
    assert.strictEqual(parseOutputRetentionCount(null), 100);
    assert.strictEqual(parseOutputRetentionCount(''), 100);
    assert.strictEqual(parseOutputRetentionCount('abc'), 100);
    assert.strictEqual(parseOutputRetentionCount('0'), 100);
    assert.strictEqual(parseOutputRetentionCount('-5'), 100);
    assert.strictEqual(parseOutputRetentionCount('2.5'), 100);
});
