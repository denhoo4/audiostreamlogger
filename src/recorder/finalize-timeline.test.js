const test = require('node:test');
const assert = require('node:assert');
const { buildTimeline, filterUsableFragments } = require('./finalize-timeline');

// Sum of segment durations — the core invariant is that this is always 3600.
function sumDuration(segments) {
    return segments.reduce((acc, s) => acc + s.durationSeconds, 0);
}

test('buildTimeline: no-gap single full-hour fragment -> one fragment, no silence', () => {
    const tl = buildTimeline([{ startOffset: 0, actualDuration: 3600, file: 'a.aac' }]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 3600, file: 'a.aac' },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: leading gap inserts silence before the fragment', () => {
    const tl = buildTimeline([{ startOffset: 120, actualDuration: 3480, file: 'a.mp3' }]);
    assert.deepStrictEqual(tl, [
        { kind: 'silence', durationSeconds: 120 },
        { kind: 'fragment', durationSeconds: 3480, file: 'a.mp3' },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: trailing gap appends silence to the hour boundary', () => {
    const tl = buildTimeline([{ startOffset: 0, actualDuration: 3000, file: 'a.mp3' }]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 3000, file: 'a.mp3' },
        { kind: 'silence', durationSeconds: 600 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: interior gap inserts silence between two fragments', () => {
    const tl = buildTimeline([
        { startOffset: 0, actualDuration: 1000, file: 'a.mp3' },
        { startOffset: 1500, actualDuration: 2100, file: 'b.mp3' },
    ]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 1000, file: 'a.mp3' },
        { kind: 'silence', durationSeconds: 500 },
        { kind: 'fragment', durationSeconds: 2100, file: 'b.mp3' },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: multiple fragments with leading, interior and trailing gaps', () => {
    const tl = buildTimeline([
        { startOffset: 60, actualDuration: 600, file: 'a.mp3' },
        { startOffset: 1000, actualDuration: 500, file: 'b.mp3' },
        { startOffset: 2000, actualDuration: 1000, file: 'c.mp3' },
    ]);
    assert.deepStrictEqual(tl, [
        { kind: 'silence', durationSeconds: 60 },
        { kind: 'fragment', durationSeconds: 600, file: 'a.mp3' },
        { kind: 'silence', durationSeconds: 340 },
        { kind: 'fragment', durationSeconds: 500, file: 'b.mp3' },
        { kind: 'silence', durationSeconds: 500 },
        { kind: 'fragment', durationSeconds: 1000, file: 'c.mp3' },
        { kind: 'silence', durationSeconds: 600 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: unsorted input is ordered by startOffset', () => {
    const tl = buildTimeline([
        { startOffset: 2000, actualDuration: 1000, file: 'c.mp3' },
        { startOffset: 0, actualDuration: 1000, file: 'a.mp3' },
    ]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 1000, file: 'a.mp3' },
        { kind: 'silence', durationSeconds: 1000 },
        { kind: 'fragment', durationSeconds: 1000, file: 'c.mp3' },
        { kind: 'silence', durationSeconds: 600 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: overlapping fragment is front-clamped to the cursor', () => {
    // b starts at 800 but a runs until 1000; b is trimmed to [1000, 2000).
    const tl = buildTimeline([
        { startOffset: 0, actualDuration: 1000, file: 'a.mp3' },
        { startOffset: 800, actualDuration: 1200, file: 'b.mp3' },
    ]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 1000, file: 'a.mp3' },
        { kind: 'fragment', durationSeconds: 1000, file: 'b.mp3' },
        { kind: 'silence', durationSeconds: 1600 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: an over-long fragment is clamped to the hour boundary', () => {
    const tl = buildTimeline([{ startOffset: 0, actualDuration: 9999, file: 'a.mp3' }]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 3600, file: 'a.mp3' },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: a fragment fully overlapped by a prior one is dropped', () => {
    const tl = buildTimeline([
        { startOffset: 0, actualDuration: 2000, file: 'a.mp3' },
        { startOffset: 500, actualDuration: 500, file: 'b.mp3' },
    ]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 2000, file: 'a.mp3' },
        { kind: 'silence', durationSeconds: 1600 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: empty list -> one full-hour silence', () => {
    const tl = buildTimeline([]);
    assert.deepStrictEqual(tl, [{ kind: 'silence', durationSeconds: 3600 }]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: zero-length / fileless / out-of-hour fragments are dropped', () => {
    const tl = buildTimeline([
        { startOffset: 0, actualDuration: 0, file: 'zero.mp3' },
        { startOffset: 100, actualDuration: 100 }, // no file
        { startOffset: 4000, actualDuration: 100, file: 'late.mp3' }, // starts past the hour
        { startOffset: 1000, actualDuration: 600, file: 'ok.mp3' },
    ]);
    assert.deepStrictEqual(tl, [
        { kind: 'silence', durationSeconds: 1000 },
        { kind: 'fragment', durationSeconds: 600, file: 'ok.mp3' },
        { kind: 'silence', durationSeconds: 2000 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: a negative startOffset is clamped to 0', () => {
    const tl = buildTimeline([{ startOffset: -50, actualDuration: 1000, file: 'a.mp3' }]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 1000, file: 'a.mp3' },
        { kind: 'silence', durationSeconds: 2600 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: plannedDuration is used when actualDuration is absent', () => {
    const tl = buildTimeline([{ startOffset: 0, plannedDuration: 1200, file: 'a.mp3' }]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 1200, file: 'a.mp3' },
        { kind: 'silence', durationSeconds: 2400 },
    ]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('buildTimeline: ext is passed through on fragment segments when present', () => {
    const tl = buildTimeline([{ startOffset: 0, actualDuration: 3600, file: 'a.aac', ext: 'aac' }]);
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 3600, file: 'a.aac', ext: 'aac' },
    ]);
});

test('buildTimeline: summed duration is exactly 3600 for a custom hourSeconds too', () => {
    const tl = buildTimeline([{ startOffset: 10, actualDuration: 20, file: 'a.mp3' }], 120);
    assert.strictEqual(sumDuration(tl), 120);
});

// --- filterUsableFragments (hotfix RC2) -------------------------------------
// The sidecar ledger can reference a fragment file that is missing / zero-byte
// on disk (the production `956-0.mp3` case). filterUsableFragments drops those
// BEFORE the timeline is built, using an injected existence predicate, so the
// missing fragment's offset range becomes silence and the hour stays 3600s.

test('filterUsableFragments: all fragments present -> list unchanged', () => {
    const present = new Set(['0-0.mp3', '1800-0.mp3']);
    const fragments = [
        { startOffset: 0, actualDuration: 1800, file: '0-0.mp3' },
        { startOffset: 1800, actualDuration: 1800, file: '1800-0.mp3' },
    ];
    const kept = filterUsableFragments(fragments, (f) => present.has(f));
    assert.deepStrictEqual(kept, fragments);
});

test('filterUsableFragments: a missing middle fragment is dropped and buildTimeline widens silence over its range to exactly 3600s', () => {
    // Three back-to-back 1200s fragments; the middle one is missing on disk.
    const present = new Set(['0-0.mp3', '2400-0.mp3']); // 1200-0.mp3 is NOT present
    const fragments = [
        { startOffset: 0, actualDuration: 1200, file: '0-0.mp3' },
        { startOffset: 1200, actualDuration: 1200, file: '956-0.mp3' }, // the production missing-fragment shape
        { startOffset: 2400, actualDuration: 1200, file: '2400-0.mp3' },
    ];
    const kept = filterUsableFragments(fragments, (f) => present.has(f));
    assert.strictEqual(kept.length, 2);
    assert.ok(!kept.some((k) => k.file === '956-0.mp3'), 'missing fragment must be dropped');

    const tl = buildTimeline(kept);
    assert.strictEqual(sumDuration(tl), 3600, 'hour stays exactly 3600s');
    assert.deepStrictEqual(tl, [
        { kind: 'fragment', durationSeconds: 1200, file: '0-0.mp3' },
        { kind: 'silence', durationSeconds: 1200 }, // widened over the dropped fragment's range
        { kind: 'fragment', durationSeconds: 1200, file: '2400-0.mp3' },
    ]);
});

test('filterUsableFragments: ALL fragments missing -> empty list -> buildTimeline is a single 3600s silence', () => {
    const present = new Set(); // nothing on disk
    const fragments = [
        { startOffset: 0, actualDuration: 1800, file: '0-0.mp3' },
        { startOffset: 1800, actualDuration: 1800, file: '956-0.mp3' },
    ];
    const kept = filterUsableFragments(fragments, (f) => present.has(f));
    assert.deepStrictEqual(kept, []);
    const tl = buildTimeline(kept);
    assert.deepStrictEqual(tl, [{ kind: 'silence', durationSeconds: 3600 }]);
    assert.strictEqual(sumDuration(tl), 3600);
});

test('filterUsableFragments: a fragment with no string file is passed through (buildTimeline drops it)', () => {
    const kept = filterUsableFragments(
        [{ startOffset: 0, actualDuration: 10 }],
        () => false,
    );
    assert.strictEqual(kept.length, 1, 'non-string file is not stat-ed; left for buildTimeline');
});

test('filterUsableFragments: non-array input -> empty list', () => {
    assert.deepStrictEqual(filterUsableFragments(null, () => true), []);
    assert.deepStrictEqual(filterUsableFragments(undefined, () => true), []);
});
