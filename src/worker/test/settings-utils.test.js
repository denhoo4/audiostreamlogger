const { test } = require('node:test');
const assert = require('node:assert');
const { validateRetentionHours } = require('../settings-utils');

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
