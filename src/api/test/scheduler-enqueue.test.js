/**
 * Integration coverage for the scheduler's no-double-enqueue guard (design §3.5,
 * A4 / AC-3a second bullet).
 *
 * Two evaluations a minute apart, both landing inside the 3-minute lookback for
 * the SAME due instant, must enqueue EXACTLY ONE jobs row. This exercises the
 * real services (schedules.markScheduleRun + jobs.enqueueJob) bound to a temp DB
 * via the same require.cache injection pattern FEAT-001 established, driving them
 * through the exact decision the scheduler's evaluate() uses: isDue ->
 * (enqueueJob + markScheduleRun).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');
const { seedJobConfig } = require('../db/seed-jobconfig');

let tmpDir;
let db;
let schedules;
let jobs;
let isDue;
let LOOKBACK_MIN;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-sched-'));
    const dbPath = path.join(tmpDir, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');

    // Inject the temp handle as the resolved '../db' module BEFORE requiring the
    // services so they bind to our handle (mirrors jobs-schema.test.js).
    const dbModulePath = require.resolve('../db');
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: db,
    };

    applySchema(db);
    seedJobConfig(db);

    schedules = require('../services/schedules');
    jobs = require('../services/jobs');
    ({ isDue, LOOKBACK_MIN } = require('../scheduler'));
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// One evaluation, exactly as the scheduler's evaluate() does it for a single
// enabled row: isDue -> (enqueueJob + markScheduleRun) when owed.
function evaluateOnce(type, now) {
    const schedule = schedules.getSchedule(type);
    if (schedule.enabled !== 1) {
        return;
    }
    const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
    if (due) {
        jobs.enqueueJob(type, 'schedule');
        schedules.markScheduleRun(type, dueInstant);
    }
}

test('two evaluations a minute apart enqueue exactly one job for the same due instant', () => {
    // Clear any seed-side rows and make the cleaner schedule hourly at minute 10.
    db.exec('DELETE FROM jobs');
    schedules.updateSchedule('cleaner', {
        enabled: 1,
        frequency: 'hourly',
        minute: 10,
        hour: 0,
        day_of_week: 0,
    });

    // Both clocks sit inside the 3-minute lookback for the 14:10 due instant.
    const firstTick = new Date(2026, 5, 10, 14, 11, 0, 0); // 1 min after
    const secondTick = new Date(2026, 5, 10, 14, 12, 0, 0); // 2 min after

    evaluateOnce('cleaner', firstTick);
    evaluateOnce('cleaner', secondTick);

    const cleanerJobs = db
        .prepare("SELECT * FROM jobs WHERE type = 'cleaner'")
        .all();
    assert.strictEqual(
        cleanerJobs.length,
        1,
        'exactly one job enqueued across two ticks of the same due instant'
    );
    assert.strictEqual(cleanerJobs[0].trigger_source, 'schedule');

    // last_run_at now records the due instant that was enqueued.
    const after = schedules.getSchedule('cleaner');
    assert.strictEqual(after.last_run_at, '2026-06-10-14-10');
});

test('a disabled schedule never enqueues', () => {
    db.exec('DELETE FROM jobs');
    schedules.updateSchedule('peakfilegenerator', {
        enabled: 0,
        frequency: 'hourly',
        minute: 5,
        hour: 0,
        day_of_week: 0,
    });

    const now = new Date(2026, 5, 10, 14, 6, 0, 0); // 1 min after a 14:05 fire
    evaluateOnce('peakfilegenerator', now);

    const count = db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'peakfilegenerator'")
        .get().n;
    assert.strictEqual(count, 0, 'a disabled schedule must not enqueue');
});
