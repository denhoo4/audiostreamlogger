/**
 * Worker copy of the shared two-way reconcile planner coverage (FEAT-002).
 *
 * src/worker/reconcile-planner.js is a byte-for-byte port of the api's
 * src/api/services/reconcile-planner.js, so these are the same pure cases as
 * src/api/test/reconcile-planner.test.js, importing the WORKER copy:
 *   - disk-only slot            -> inserts
 *   - db-only row               -> removes
 *   - db-only row guarded by    -> NOT removed  (current-hour OR status 'recording')
 *   - drifted status/count      -> updates
 *   - current-hour slot         -> never in updates
 *   - matching both sides       -> empty inserts/removes/updates (idempotent)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { reconcilePlan } = require('../reconcile-planner');

function scanned(folder, date, hour, part) {
    return {
        folder,
        date,
        hour,
        part,
        file_path: `/audio/${folder}/${folder}-${date}-${hour}${
            part === 1 ? '' : `.part${part}`
        }.mp3`,
    };
}

function row(folder, date, hour, extra = {}) {
    return {
        stream_folder: folder,
        date,
        hour,
        status: 'complete',
        segment_count: 1,
        file_path: `/audio/${folder}/${folder}-${date}-${hour}.mp3`,
        ...extra,
    };
}

test('disk-only slot -> inserts', () => {
    const plan = reconcilePlan([], [scanned('radio1', '2026-10-23', '09', 1)]);
    assert.strictEqual(plan.inserts.length, 1);
    assert.strictEqual(plan.removes.length, 0);
    assert.strictEqual(plan.updates.length, 0);
    assert.deepStrictEqual(plan.inserts[0], {
        stream_folder: 'radio1',
        date: '2026-10-23',
        hour: '09',
        file_path: '/audio/radio1/radio1-2026-10-23-09.mp3',
        status: 'complete',
        segment_count: 1,
    });
});

test('db-only row -> removes (full-sync)', () => {
    const plan = reconcilePlan([row('radio1', '2026-10-23', '09')], []);
    assert.strictEqual(plan.inserts.length, 0);
    assert.strictEqual(plan.updates.length, 0);
    assert.deepStrictEqual(plan.removes, [
        { stream_folder: 'radio1', date: '2026-10-23', hour: '09' },
    ]);
});

test("db-only row that is the current-hour slot -> NOT removed", () => {
    const plan = reconcilePlan([row('radio1', '2026-10-23', '09')], [], {
        currentStamp: '2026-10-23-09',
    });
    assert.strictEqual(plan.removes.length, 0, 'current hour is guarded');
    assert.strictEqual(plan.inserts.length, 0);
    assert.strictEqual(plan.updates.length, 0);
});

test("db-only row with status 'recording' -> NOT removed", () => {
    const plan = reconcilePlan(
        [row('radio1', '2026-10-23', '09', { status: 'recording' })],
        []
    );
    assert.strictEqual(plan.removes.length, 0, "'recording' row is guarded");
});

test('slot whose status/segment_count drifted -> updates', () => {
    // DB thinks 'complete'/1; disk now has a .part2 -> 'partial'/2.
    const existing = [row('radio1', '2026-10-23', '09')];
    const files = [
        scanned('radio1', '2026-10-23', '09', 1),
        scanned('radio1', '2026-10-23', '09', 2),
    ];
    const plan = reconcilePlan(existing, files);
    assert.strictEqual(plan.inserts.length, 0);
    assert.strictEqual(plan.removes.length, 0);
    assert.strictEqual(plan.updates.length, 1);
    assert.deepStrictEqual(plan.updates[0], {
        stream_folder: 'radio1',
        date: '2026-10-23',
        hour: '09',
        status: 'partial',
        segment_count: 2,
        file_path: '/audio/radio1/radio1-2026-10-23-09.mp3',
    });
});

test('current-hour slot is never in updates even when drifted', () => {
    const existing = [row('radio1', '2026-10-23', '09')];
    const files = [
        scanned('radio1', '2026-10-23', '09', 1),
        scanned('radio1', '2026-10-23', '09', 2),
    ];
    const plan = reconcilePlan(existing, files, { currentStamp: '2026-10-23-09' });
    assert.strictEqual(plan.updates.length, 0, 'mid-write hour is never restatused');
    assert.strictEqual(plan.inserts.length, 0);
    assert.strictEqual(plan.removes.length, 0);
});

test("status 'recording' slot is never in updates even when drifted", () => {
    const existing = [row('radio1', '2026-10-23', '09', { status: 'recording' })];
    const files = [
        scanned('radio1', '2026-10-23', '09', 1),
        scanned('radio1', '2026-10-23', '09', 2),
    ];
    const plan = reconcilePlan(existing, files);
    assert.strictEqual(plan.updates.length, 0, "'recording' row is never restatused");
});

test('matching both sides -> empty inserts/removes/updates (idempotent)', () => {
    const existing = [
        row('radio1', '2026-10-23', '09'),
        row('radio2', '2026-10-23', '00'),
    ];
    const files = [
        scanned('radio1', '2026-10-23', '09', 1),
        scanned('radio2', '2026-10-23', '00', 1),
    ];
    const plan = reconcilePlan(existing, files);
    assert.strictEqual(plan.inserts.length, 0);
    assert.strictEqual(plan.removes.length, 0);
    assert.strictEqual(plan.updates.length, 0);
});
