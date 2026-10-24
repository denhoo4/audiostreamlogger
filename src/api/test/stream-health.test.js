/**
 * Pure unit coverage for services/stream-health.js::deriveStreamHealth — no DB,
 * no fs. Each case injects literal `streams`, `rows`, `currentSlot`, and
 * `windowHours`, mirroring the pure-helper style of recordings.test.js.
 *
 * Window math: windowSlots(currentSlot, windowHours) returns the last
 * `windowHours` hour-slots ending at (and including) currentSlot, derived from
 * expectedHourSlots. To keep the fixtures readable, every test uses a
 * currentSlot that does NOT straddle midnight for the small windows it builds.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const {
    deriveStreamHealth,
    summarizeHealth,
    windowSlots,
} = require('../services/stream-health');

const pad = (n) => String(n).padStart(2, '0');

/** Build complete rows for a folder for hours [fromHour..toHour] on a date. */
function completeRows(folder, date, fromHour, toHour, status = 'complete') {
    const rows = [];
    for (let h = fromHour; h <= toHour; h += 1) {
        rows.push({ stream_folder: folder, date, hour: pad(h), status });
    }
    return rows;
}

test('healthy stream with a complete row for every past slot → ok', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' }; // 8h window → slots 05..12
    const windowHours = 8;
    // complete 05..11 (past), plus a live `recording` row for the current 12.
    const rows = [
        ...completeRows('nl_one', date, 5, 11),
        { stream_folder: 'nl_one', date, hour: '12', status: 'recording' },
    ];

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_one', name: 'NL One' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.status, 'ok');
    assert.strictEqual(h.consecutiveMissing, 0);
    assert.strictEqual(h.expectedInWindow, 8);
    assert.strictEqual(h.presentInWindow, 8); // 7 past complete + 1 live
    assert.deepStrictEqual(h.lastSuccessfulSlot, { date, hour: '11' });
    assert.strictEqual(h.name, 'NL One');
});

test('stopped stream (no in-window rows, only an all-time last-complete) → down', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 6; // past slots 06..11 (6 slots incl current 12)
    // This models EXACTLY what the route hands the helper for a long-stopped
    // stream: the window-scoped `rows` are EMPTY (the recorder stopped before
    // the window, so listRecentByDate returns nothing for it), and the
    // never-vs-down distinction comes solely from the injected all-time
    // lastCompleteByFolder signal (MAX complete slot over ALL history).
    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_down', name: 'NL Down' }],
        rows: [],
        currentSlot,
        windowHours,
        lastCompleteByFolder: { nl_down: '2026-10-22-03' },
    });

    // Had a complete once (all-time signal) but nothing good in the window →
    // down, NOT never. This is the regression the review flagged.
    assert.strictEqual(h.status, 'down');
    // past slots 06..11 are all missing → 5 slots before current (12 is graced).
    assert.strictEqual(h.consecutiveMissing, windowHours - 1);
    assert.notStrictEqual(h.lastSuccessfulSlot, null);
    assert.deepStrictEqual(h.lastSuccessfulSlot, {
        date: '2026-10-22',
        hour: '03',
    });
    assert.strictEqual(h.presentInWindow, 0);
});

test('stopped stream with an in-window complete newer than the all-time signal keeps the newer slot', () => {
    // Defensive: if the window rows carry a complete newer than a stale all-time
    // signal, lastSuccessfulSlot reflects the newer one.
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 8; // past slots 05..11
    const rows = [
        { stream_folder: 'nl_mix', date, hour: '05', status: 'complete' },
    ];

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_mix', name: 'NL Mix' }],
        rows,
        currentSlot,
        windowHours,
        lastCompleteByFolder: { nl_mix: '2026-10-20-00' }, // stale, older
    });

    assert.deepStrictEqual(h.lastSuccessfulSlot, { date, hour: '05' });
});

test('intermittent partials/missing → degraded', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 8; // past slots 05..11
    const rows = [
        { stream_folder: 'nl_mix', date, hour: '05', status: 'complete' },
        { stream_folder: 'nl_mix', date, hour: '06', status: 'partial' },
        { stream_folder: 'nl_mix', date, hour: '07', status: 'complete' },
        // 08 missing (no row)
        { stream_folder: 'nl_mix', date, hour: '09', status: 'complete' },
        { stream_folder: 'nl_mix', date, hour: '10', status: 'complete' },
        { stream_folder: 'nl_mix', date, hour: '11', status: 'complete' },
    ];

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_mix', name: 'NL Mix' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.status, 'degraded');
    // Trailing past slot (11) is complete → streak 0.
    assert.strictEqual(h.consecutiveMissing, 0);
    assert.deepStrictEqual(h.lastSuccessfulSlot, { date, hour: '11' });
});

test('brand-new stream with zero rows and no all-time complete → never', () => {
    const currentSlot = { date: '2026-10-23', hour: '12' };
    // No rows AND no entry in lastCompleteByFolder → the stream never recorded
    // a single complete slot in all history → never (distinct from down).
    const [h] = deriveStreamHealth({
        streams: [{ folder: 'brand_new', name: 'Brand New' }],
        rows: [],
        currentSlot,
        windowHours: 24,
        lastCompleteByFolder: {}, // nothing ever completed for any folder
    });

    assert.strictEqual(h.status, 'never');
    assert.strictEqual(h.lastSuccessfulSlot, null);
    assert.strictEqual(h.presentInWindow, 0);
    assert.strictEqual(h.expectedInWindow, 24);
});

test('consecutive-missing counts the trailing run and ignores the current hour', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 8; // past slots 05..11
    // complete 05..08, then 09,10,11 missing (3 trailing). No row for 12.
    const rows = completeRows('nl_streak', date, 5, 8);

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_streak', name: 'NL Streak' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.consecutiveMissing, 3);
    assert.strictEqual(h.status, 'degraded'); // some healthy + some failures
    assert.deepStrictEqual(h.lastSuccessfulSlot, { date, hour: '08' });
});

test('current-hour grace: complete past, no current-hour row → still ok', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 6; // past slots 06..11 + current 12
    const rows = completeRows('nl_grace', date, 6, 11); // no row for 12

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_grace', name: 'NL Grace' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.status, 'ok');
    assert.strictEqual(h.consecutiveMissing, 0);
});

test('windowSlots returns exactly windowHours trailing slots ending at currentSlot', () => {
    const slots = windowSlots({ date: '2026-10-23', hour: '02' }, 5);
    assert.strictEqual(slots.length, 5);
    // 5 slots ending at 02 on 2026-10-23 → 22,23 on the 22nd + 00,01,02 on 23rd.
    assert.deepStrictEqual(slots, [
        { date: '2026-10-22', hour: '22' },
        { date: '2026-10-22', hour: '23' },
        { date: '2026-10-23', hour: '00' },
        { date: '2026-10-23', hour: '01' },
        { date: '2026-10-23', hour: '02' },
    ]);
});

test('summarizeHealth rolls up counts with unhealthy = non-ok total', () => {
    const counts = summarizeHealth([
        { status: 'ok' },
        { status: 'ok' },
        { status: 'down' },
        { status: 'degraded' },
        { status: 'never' },
    ]);
    assert.deepStrictEqual(counts, {
        total: 5,
        unhealthy: 3,
        ok: 2,
        degraded: 1,
        down: 1,
        never: 1,
    });
});
