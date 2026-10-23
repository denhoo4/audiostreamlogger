const test = require('node:test');
const assert = require('node:assert');
const { backoffDelayMs, shouldRestartWithinHour, segmentOutputName } = require('./backoff-helpers');

const OPTS = { baseMs: 1000, capMs: 30000 };

test('backoffDelayMs: attempt 0 returns the base delay', () => {
    assert.strictEqual(backoffDelayMs(0, OPTS), 1000);
});

test('backoffDelayMs: grows exponentially from the base', () => {
    assert.strictEqual(backoffDelayMs(1, OPTS), 2000);
    assert.strictEqual(backoffDelayMs(2, OPTS), 4000);
    assert.strictEqual(backoffDelayMs(3, OPTS), 8000);
    assert.strictEqual(backoffDelayMs(4, OPTS), 16000);
});

test('backoffDelayMs: is capped at capMs for large attempts', () => {
    assert.strictEqual(backoffDelayMs(5, OPTS), 30000); // 32000 -> cap
    assert.strictEqual(backoffDelayMs(10, OPTS), 30000);
    assert.strictEqual(backoffDelayMs(100, OPTS), 30000);
});

test('backoffDelayMs: never dips below the base and never overflows', () => {
    assert.strictEqual(backoffDelayMs(-5, OPTS), 1000);
    assert.strictEqual(backoffDelayMs(1e9, OPTS), 30000);
    assert.ok(Number.isFinite(backoffDelayMs(5000, OPTS)));
});

test('shouldRestartWithinHour: true when more than the floor remains', () => {
    assert.strictEqual(shouldRestartWithinHour(120, 30), true);
});

test('shouldRestartWithinHour: false at or below the floor', () => {
    assert.strictEqual(shouldRestartWithinHour(30, 30), false);
    assert.strictEqual(shouldRestartWithinHour(10, 30), false);
});

test('shouldRestartWithinHour: boundary just above the floor', () => {
    assert.strictEqual(shouldRestartWithinHour(31, 30), true);
});

test('segmentOutputName: attempt 0 keeps the exact plain name', () => {
    assert.strictEqual(segmentOutputName('radio1', '2026-10-23-14', 0), 'radio1-2026-10-23-14.mp3');
});

test('segmentOutputName: attempt >= 1 uses .partN suffixes (N = attempt + 1)', () => {
    assert.strictEqual(segmentOutputName('radio1', '2026-10-23-14', 1), 'radio1-2026-10-23-14.part2.mp3');
    assert.strictEqual(segmentOutputName('radio1', '2026-10-23-14', 2), 'radio1-2026-10-23-14.part3.mp3');
});

test('segmentOutputName: negative/invalid attempt falls back to the plain name', () => {
    assert.strictEqual(segmentOutputName('radio1', '2026-10-23-14', -1), 'radio1-2026-10-23-14.mp3');
});
