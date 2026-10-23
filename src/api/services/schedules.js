/**
 * Schedules data-access layer over the api's write handle (design §1.4).
 *
 * One row per job type (PK = type). updateSchedule validates every field before
 * writing (enums + ranges unified to 0..59 for minute per design §1.2) and
 * throws ScheduleValidationError({field, error}) so the route can return a clean
 * 400 {error, field}. markScheduleRun records the last due-instant enqueued so
 * the scheduler avoids double-enqueuing within one due instant (A4).
 */
const db = require('../db');

const SCHEDULE_COLUMNS =
    'type, enabled, frequency, minute, hour, day_of_week, last_run_at';

const FREQUENCIES = ['hourly', 'daily', 'weekly'];

class ScheduleValidationError extends Error {
    constructor(field, error) {
        super(error);
        this.name = 'ScheduleValidationError';
        this.field = field;
        this.error = error;
    }
}

function isIntInRange(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

/** List all schedule rows ordered by type. */
function listSchedules() {
    return db
        .prepare(`SELECT ${SCHEDULE_COLUMNS} FROM schedules ORDER BY type`)
        .all();
}

/** Fetch a single schedule by type, or undefined. */
function getSchedule(type) {
    return db
        .prepare(`SELECT ${SCHEDULE_COLUMNS} FROM schedules WHERE type = ?`)
        .get(type);
}

/**
 * Update a schedule row. Validates enabled (0/1), frequency (enum), minute
 * (0..59), hour (0..23), day_of_week (0..6). Returns the updated row, or null if
 * no schedule with that type exists. Throws ScheduleValidationError on a bad
 * field.
 */
function updateSchedule(type, { enabled, frequency, minute, hour, day_of_week }) {
    if (enabled !== 0 && enabled !== 1) {
        throw new ScheduleValidationError('enabled', 'enabled must be 0 or 1');
    }
    if (!FREQUENCIES.includes(frequency)) {
        throw new ScheduleValidationError(
            'frequency',
            'frequency must be one of hourly, daily, weekly'
        );
    }
    if (!isIntInRange(minute, 0, 59)) {
        throw new ScheduleValidationError(
            'minute',
            'minute must be an integer between 0 and 59'
        );
    }
    if (!isIntInRange(hour, 0, 23)) {
        throw new ScheduleValidationError(
            'hour',
            'hour must be an integer between 0 and 23'
        );
    }
    if (!isIntInRange(day_of_week, 0, 6)) {
        throw new ScheduleValidationError(
            'day_of_week',
            'day_of_week must be an integer between 0 and 6'
        );
    }

    const existing = getSchedule(type);
    if (!existing) {
        return null;
    }

    db.prepare(
        'UPDATE schedules SET enabled = ?, frequency = ?, minute = ?, hour = ?, day_of_week = ? WHERE type = ?'
    ).run(enabled, frequency, minute, hour, day_of_week, type);
    return getSchedule(type);
}

/** Record the last due-instant string enqueued for a job type (A4 guard). */
function markScheduleRun(type, dueInstant) {
    db.prepare('UPDATE schedules SET last_run_at = ? WHERE type = ?').run(
        dueInstant,
        type
    );
}

module.exports = {
    listSchedules,
    getSchedule,
    updateSchedule,
    markScheduleRun,
    ScheduleValidationError,
};
