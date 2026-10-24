/**
 * Idempotent, SYNCHRONOUS seeding of the job-queue schedule + scalar config rows
 * (design §1.2 / §1.3).
 *
 * seedJobConfig(db) inserts the default `schedules` rows (cleaner hourly at
 * minute 10, peakfilegenerator hourly at minute 5, reconcile daily at 03:30, all
 * enabled) and the three `app_config` scalars (log_retention="2", recorder_minute="0",
 * output_retention_count="100") the first time it runs. Every insert is
 * insert-if-absent (keyed on the primary key), so a second boot never overwrites
 * a value the user has since changed — mirroring seedAdmin's idempotency. It is
 * synchronous (no argon2) so it is kept separate from seedAdmin and runs inline
 * right after applySchema, before the awaited seedAdmin (NIT-4).
 */

const SCHEDULE_DEFAULTS = [
    { type: 'cleaner', frequency: 'hourly', minute: 10, hour: 0, enabled: 1 },
    { type: 'peakfilegenerator', frequency: 'hourly', minute: 5, hour: 0, enabled: 1 },
    { type: 'reconcile', frequency: 'daily', minute: 30, hour: 3, enabled: 1 },
];

const CONFIG_DEFAULTS = [
    { key: 'log_retention', value: '2' },
    { key: 'recorder_minute', value: '0' },
    { key: 'output_retention_count', value: '100' },
    { key: 'app_title', value: 'Dé radiologger' },
];

function seedJobConfig(db) {
    const insertSchedule = db.prepare(
        'INSERT OR IGNORE INTO schedules (type, enabled, frequency, minute, hour) VALUES (?, ?, ?, ?, ?)'
    );
    for (const s of SCHEDULE_DEFAULTS) {
        insertSchedule.run(s.type, s.enabled, s.frequency, s.minute, s.hour);
    }

    const insertConfig = db.prepare(
        'INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)'
    );
    for (const c of CONFIG_DEFAULTS) {
        insertConfig.run(c.key, c.value);
    }
}

module.exports = { seedJobConfig };
