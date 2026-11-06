const test = require('node:test');
const assert = require('node:assert');
const { buildTimeline } = require('./finalize-timeline');

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
