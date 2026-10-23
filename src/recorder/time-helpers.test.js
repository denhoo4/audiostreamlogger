const test = require('node:test');
const assert = require('node:assert');
const { secondsUntilNextHour, currentHourStamp } = require('./time-helpers');

// Build a Date from explicit LOCAL components so assertions are TZ-stable:
// the helpers read local-time getters, and so does this constructor.
function localDate(y, mo, d, h, mi, s, ms = 0) {
    return new Date(y, mo - 1, d, h, mi, s, ms);
}

test('secondsUntilNextHour: mid-hour', () => {
    assert.strictEqual(secondsUntilNextHour(localDate(2026, 10, 23, 14, 37, 10)), 1370);
});

test('secondsUntilNextHour: early in the hour', () => {
    assert.strictEqual(secondsUntilNextHour(localDate(2026, 10, 23, 14, 0, 30)), 3570);
});

test('secondsUntilNextHour: exact top-of-hour returns a full 3600, not 0', () => {
    assert.strictEqual(secondsUntilNextHour(localDate(2026, 10, 23, 14, 0, 0)), 3600);
});

test('secondsUntilNextHour: last second of the hour', () => {
    assert.strictEqual(secondsUntilNextHour(localDate(2026, 10, 23, 14, 59, 59)), 1);
});

test('secondsUntilNextHour: sub-second milliseconds are ignored', () => {
    assert.strictEqual(secondsUntilNextHour(localDate(2026, 10, 23, 14, 0, 0, 999)), 3600);
});

test('currentHourStamp: zero-pads month, day and hour', () => {
    assert.strictEqual(currentHourStamp(localDate(2026, 1, 5, 9, 42, 17)), '2026-01-05-09');
});

test('currentHourStamp: two-digit components', () => {
    assert.strictEqual(currentHourStamp(localDate(2026, 12, 31, 23, 0, 0)), '2026-12-31-23');
});
