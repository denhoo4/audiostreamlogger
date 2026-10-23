const { test } = require('node:test');
const assert = require('node:assert');
const { planTick } = require('../claim');

test('planTick: empty pending set is idle', () => {
    assert.deepStrictEqual(planTick({ pending: [] }), { claim: null, skip: [] });
});

test('planTick: a single pending job is claimed, nothing skipped', () => {
    assert.deepStrictEqual(planTick({ pending: [{ id: 7 }] }), {
        claim: 7,
        skip: [],
    });
});

test('planTick: oldest is claimed, the rest are skipped as busy', () => {
    assert.deepStrictEqual(
        planTick({ pending: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
        { claim: 1, skip: [2, 3] }
    );
});
