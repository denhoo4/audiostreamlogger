/**
 * Pure unit coverage for services/stream-health.js::deriveStreamHealth — no DB,
 * no fs. Each case injects literal `streams`, `rows`, `currentSlot`, and
 * `windowHours`, mirroring the pure-helper style of recordings.test.js.
 *
 * The panel is TWO independent signals:
 *   - recordingNow: decided ONLY from the CURRENT slot's row status (never from
 *     the 24h window).
 *   - last24h: an informational gap summary over the window's PAST slots (the
 *     in-progress current slot is excluded). A slot is a GAP when it has no
 *     `complete` row (no row at all, or only `partial`). `complete` = filled.
 *
 * Window math: windowSlots(currentSlot, windowHours) returns the last
 * `windowHours` hour-slots ending at (and including) currentSlot. To keep the
 * fixtures readable, every test uses a currentSlot that does NOT straddle
 * midnight for the small windows it builds.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const {
    deriveStreamHealth,
    summarizeHealth,
    windowSlots,
} = require('../services/stream-health');

const pad = (n) => String(n).padStart(2, '0');

/** Build rows for a folder for hours [fromHour..toHour] on a date. */
function rowsForHours(folder, date, fromHour, toHour, status = 'complete') {
    const rows = [];
    for (let h = fromHour; h <= toHour; h += 1) {
        rows.push({ stream_folder: folder, date, hour: pad(h), status });
    }
    return rows;
}

test('(a) current slot has a `recording` row → recordingNow true even when earlier hours are missing', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' }; // 8h window → slots 05..12
    const windowHours = 8;
    // NO past rows at all (05..11 missing), only a live `recording` row for 12.
    const rows = [{ stream_folder: 'nl_one', date, hour: '12', status: 'recording' }];

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_one', name: 'NL One' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.recordingNow, true);
    assert.strictEqual(h.lastSlotStatus, 'recording');
    // The 24h column is independent: all 7 past slots are gaps.
    assert.strictEqual(h.last24h.complete, false);
    assert.strictEqual(h.last24h.gapCount, 7);
    assert.strictEqual(h.name, 'NL One');
});

test('(b) no row for the current slot → recordingNow false even when all past slots are complete', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 8; // past slots 05..11 complete, no row for 12
    const rows = rowsForHours('nl_two', date, 5, 11);

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_two', name: 'NL Two' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.recordingNow, false);
    assert.strictEqual(h.lastSlotStatus, null);
    // Past slots are all complete → the 24h column is complete, no gaps.
    assert.strictEqual(h.last24h.complete, true);
    assert.deepStrictEqual(h.last24h.gaps, []);
});

test('current slot `complete`/`partial` → recordingNow true (defensive finalize)', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 4;

    const [complete] = deriveStreamHealth({
        streams: [{ folder: 'nl_c', name: 'NL C' }],
        rows: [{ stream_folder: 'nl_c', date, hour: '12', status: 'complete' }],
        currentSlot,
        windowHours,
    });
    assert.strictEqual(complete.recordingNow, true);

    const [partial] = deriveStreamHealth({
        streams: [{ folder: 'nl_p', name: 'NL P' }],
        rows: [{ stream_folder: 'nl_p', date, hour: '12', status: 'partial' }],
        currentSlot,
        windowHours,
    });
    assert.strictEqual(partial.recordingNow, true);
});

test('(d) a fully-covered 24h → last24h.complete true, no gaps', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 6; // past slots 06..11 + current 12
    // complete 06..11 (every past slot) + a live recording row for 12.
    const rows = [
        ...rowsForHours('nl_full', date, 6, 11),
        { stream_folder: 'nl_full', date, hour: '12', status: 'recording' },
    ];

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_full', name: 'NL Full' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.recordingNow, true);
    assert.strictEqual(h.last24h.complete, true);
    assert.strictEqual(h.last24h.gapCount, 0);
    assert.deepStrictEqual(h.last24h.gaps, []);
});

test('(c)/(e) the 24h gap summary lists the correct missing hours in order', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 8; // past slots 05..11
    // complete 05, 07, 08, 10, 11 — missing 06 and 09.
    const rows = [
        { stream_folder: 'nl_gap', date, hour: '05', status: 'complete' },
        { stream_folder: 'nl_gap', date, hour: '07', status: 'complete' },
        { stream_folder: 'nl_gap', date, hour: '08', status: 'complete' },
        { stream_folder: 'nl_gap', date, hour: '10', status: 'complete' },
        { stream_folder: 'nl_gap', date, hour: '11', status: 'complete' },
        // current 12 has no row
    ];

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_gap', name: 'NL Gap' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.last24h.complete, false);
    assert.strictEqual(h.last24h.gapCount, 2);
    assert.deepStrictEqual(h.last24h.gaps, [
        { date, hour: '06' },
        { date, hour: '09' },
    ]);
});

test('(f) a past `partial` hour counts as a gap (complete = filled)', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 4; // past slots 09..11
    const rows = [
        { stream_folder: 'nl_part', date, hour: '09', status: 'complete' },
        { stream_folder: 'nl_part', date, hour: '10', status: 'partial' }, // gap
        { stream_folder: 'nl_part', date, hour: '11', status: 'complete' },
    ];

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_part', name: 'NL Part' }],
        rows,
        currentSlot,
        windowHours,
    });

    assert.strictEqual(h.last24h.gapCount, 1);
    assert.deepStrictEqual(h.last24h.gaps, [{ date, hour: '10' }]);
});

test('(g) the in-progress current hour is EXCLUDED from gaps', () => {
    const date = '2026-10-23';
    const currentSlot = { date, hour: '12' };
    const windowHours = 6; // past slots 06..11 all complete, current 12 empty
    const rows = rowsForHours('nl_cur', date, 6, 11);

    const [h] = deriveStreamHealth({
        streams: [{ folder: 'nl_cur', name: 'NL Cur' }],
        rows,
        currentSlot,
        windowHours,
    });

    // The current slot (12) has no row, yet it must NOT be reported as a gap.
    assert.strictEqual(h.recordingNow, false);
    assert.strictEqual(h.last24h.complete, true);
    assert.deepStrictEqual(h.last24h.gaps, []);
    assert.ok(!h.last24h.gaps.some((g) => g.hour === '12'));
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

test('(i) summarizeHealth rolls up {total, recordingNow, notRecording}', () => {
    const counts = summarizeHealth([
        { recordingNow: true },
        { recordingNow: true },
        { recordingNow: false },
        { recordingNow: false },
        { recordingNow: false },
    ]);
    assert.deepStrictEqual(counts, {
        total: 5,
        recordingNow: 2,
        notRecording: 3,
    });
});
