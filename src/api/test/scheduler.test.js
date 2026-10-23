/**
 * Pure-logic coverage for the api scheduler (design §3.5, AC-3a).
 *
 * These tests exercise previousScheduledInstant / withinLookback / isDue without
 * touching the DB. They assume the process TZ is Europe/Amsterdam (the container
 * TZ, and what the runner sets); the DST cases below only make sense under that
 * zone. A guard skips the DST assertions if the runner is not in that zone so the
 * suite never produces a misleading pass.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const {
    previousScheduledInstant,
    withinLookback,
    isDue,
    LOOKBACK_MIN,
} = require('../scheduler');

// Local Date at the given wall-clock fields (TZ-dependent, which is the point).
function localDate(y, mo, d, h, mi, s = 0) {
    return new Date(y, mo - 1, d, h, mi, s, 0);
}

const inAmsterdam =
    Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/Amsterdam';

test('previousScheduledInstant hourly: this hour when now.minute >= schedule.minute', () => {
    const schedule = { frequency: 'hourly', minute: 10 };
    // now = 14:25 -> most recent fire is 14:10.
    const now = localDate(2026, 3, 15, 14, 25);
    assert.strictEqual(
        previousScheduledInstant(schedule, now),
        '2026-03-15-14-10'
    );
});

test('previousScheduledInstant hourly: previous hour when now.minute < schedule.minute', () => {
    const schedule = { frequency: 'hourly', minute: 40 };
    // now = 14:25 -> candidate 14:40 is in the future -> step back to 13:40.
    const now = localDate(2026, 3, 15, 14, 25);
    assert.strictEqual(
        previousScheduledInstant(schedule, now),
        '2026-03-15-13-40'
    );
});

test('previousScheduledInstant daily: today when the configured time has passed', () => {
    const schedule = { frequency: 'daily', hour: 3, minute: 30 };
    const now = localDate(2026, 6, 10, 9, 0);
    assert.strictEqual(
        previousScheduledInstant(schedule, now),
        '2026-06-10-03-30'
    );
});

test('previousScheduledInstant daily: yesterday when the configured time is still ahead today', () => {
    const schedule = { frequency: 'daily', hour: 23, minute: 15 };
    const now = localDate(2026, 6, 10, 9, 0);
    assert.strictEqual(
        previousScheduledInstant(schedule, now),
        '2026-06-09-23-15'
    );
});

test('previousScheduledInstant weekly: walks back to the most recent matching weekday', () => {
    // day_of_week 1 = Monday. 2026-06-10 is a Wednesday; most recent Monday at
    // 08:00 is 2026-06-08.
    const schedule = { frequency: 'weekly', hour: 8, minute: 0, day_of_week: 1 };
    const now = localDate(2026, 6, 10, 9, 0);
    assert.strictEqual(
        previousScheduledInstant(schedule, now),
        '2026-06-08-08-00'
    );
});

test('previousScheduledInstant weekly: same day but time not yet reached -> previous week', () => {
    // day_of_week 3 = Wednesday, 18:00. now is Wednesday 2026-06-10 at 09:00,
    // so this week's fire is still ahead -> go back to last Wednesday.
    const schedule = {
        frequency: 'weekly',
        hour: 18,
        minute: 0,
        day_of_week: 3,
    };
    const now = localDate(2026, 6, 10, 9, 0);
    assert.strictEqual(
        previousScheduledInstant(schedule, now),
        '2026-06-03-18-00'
    );
});

test('previousScheduledInstant daily keeps HH:MM when the step-back crosses the spring-forward DST transition', () => {
    if (!inAmsterdam) {
        return; // DST assertion is only meaningful in Europe/Amsterdam.
    }
    // Europe/Amsterdam spring-forward is 2026-03-29 02:00 -> 03:00 (a 23 h day).
    // A daily 08:30 schedule evaluated on 2026-03-30 at 07:00: today's 08:30 is
    // still ahead, so the step-back (setDate(-1)) must land on the 29th at 08:30
    // — crossing the 23 h transition day. A naive -86400000 ms step would land
    // on 07:30 (an hour off). The wall-clock 08:30 must be preserved.
    const schedule = { frequency: 'daily', hour: 8, minute: 30 };
    const now = localDate(2026, 3, 30, 7, 0); // Monday, the day after the jump
    const instant = previousScheduledInstant(schedule, now);
    assert.ok(
        instant.endsWith('-08-30'),
        `expected the stamp to keep 08:30 across the DST day, got ${instant}`
    );
    assert.strictEqual(instant, '2026-03-29-08-30');
});

test('previousScheduledInstant weekly keeps HH:MM when the step-back crosses the fall-back DST transition', () => {
    if (!inAmsterdam) {
        return;
    }
    // Europe/Amsterdam fall-back is 2026-10-25 03:00 -> 02:00 (a 25 h day). A
    // weekly Sunday (day_of_week 0) 09:00 schedule evaluated the following
    // Tuesday (2026-10-27) walks back day-by-day to Sunday the 25th at 09:00 —
    // the step-back crosses the 25 h transition day. A naive -7*86400000 ms step
    // from a Sunday would drift by an hour; the calendar-field walk keeps 09:00.
    const schedule = {
        frequency: 'weekly',
        hour: 9,
        minute: 0,
        day_of_week: 0,
    };
    const now = localDate(2026, 10, 27, 12, 0); // Tuesday after the fall-back
    const instant = previousScheduledInstant(schedule, now);
    assert.ok(
        instant.endsWith('-09-00'),
        `expected the stamp to keep 09:00 across the DST day, got ${instant}`
    );
    assert.strictEqual(instant, '2026-10-25-09-00');
});

test('withinLookback: true inside the window, false beyond it, false for a future instant', () => {
    const now = localDate(2026, 6, 10, 14, 12);
    // Due at 14:10, now 14:12 -> 2 min, within 3.
    assert.strictEqual(withinLookback('2026-06-10-14-10', now, 3), true);
    // Due at 14:00, now 14:12 -> 12 min, beyond 3.
    assert.strictEqual(withinLookback('2026-06-10-14-00', now, 3), false);
    // Due instant in the future relative to now.
    assert.strictEqual(withinLookback('2026-06-10-14-30', now, 3), false);
});

test('isDue hourly fires at the matching instant', () => {
    const schedule = {
        type: 'cleaner',
        frequency: 'hourly',
        minute: 10,
        last_run_at: null,
    };
    const now = localDate(2026, 6, 10, 14, 11); // 1 min after the 14:10 fire
    const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
    assert.strictEqual(due, true);
    assert.strictEqual(dueInstant, '2026-06-10-14-10');
});

test('isDue daily fires at the matching instant', () => {
    const schedule = {
        type: 'cleaner',
        frequency: 'daily',
        hour: 3,
        minute: 30,
        last_run_at: null,
    };
    const now = localDate(2026, 6, 10, 3, 31);
    const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
    assert.strictEqual(due, true);
    assert.strictEqual(dueInstant, '2026-06-10-03-30');
});

test('isDue weekly fires at the matching instant', () => {
    // day_of_week 1 = Monday; 2026-06-08 is a Monday.
    const schedule = {
        type: 'peakfilegenerator',
        frequency: 'weekly',
        hour: 8,
        minute: 0,
        day_of_week: 1,
        last_run_at: null,
    };
    const now = localDate(2026, 6, 8, 8, 1);
    const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
    assert.strictEqual(due, true);
    assert.strictEqual(dueInstant, '2026-06-08-08-00');
});

test('isDue: an evaluation one minute late STILL fires (now = dueInstant + 60s)', () => {
    const schedule = {
        type: 'cleaner',
        frequency: 'hourly',
        minute: 10,
        last_run_at: null,
    };
    // now = 14:11:00, exactly one minute after the 14:10 due instant.
    const now = localDate(2026, 6, 10, 14, 11, 0);
    const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
    assert.strictEqual(due, true);
    assert.strictEqual(dueInstant, '2026-06-10-14-10');
});

test('isDue: a stale instant beyond LOOKBACK_MIN does NOT fire', () => {
    const schedule = {
        type: 'cleaner',
        frequency: 'hourly',
        minute: 10,
        last_run_at: null,
    };
    // now = 14:20, the 14:10 fire is 10 min stale -> beyond the 3-min lookback.
    const now = localDate(2026, 6, 10, 14, 20);
    const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
    assert.strictEqual(due, false);
    assert.strictEqual(dueInstant, '2026-06-10-14-10');
});

test('isDue: the last_run_at === dueInstant guard suppresses a second evaluation', () => {
    const schedule = {
        type: 'cleaner',
        frequency: 'hourly',
        minute: 10,
        last_run_at: '2026-06-10-14-10',
    };
    const now = localDate(2026, 6, 10, 14, 11);
    const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
    assert.strictEqual(due, false, 'already-enqueued instant must not re-fire');
    assert.strictEqual(dueInstant, '2026-06-10-14-10');
});
