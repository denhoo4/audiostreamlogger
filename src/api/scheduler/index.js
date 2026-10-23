/**
 * DB-driven scheduler hosted in the api (design §3).
 *
 * The api owns the single write handle and runs continuously, so it is the sole
 * enqueuer of scheduled job rows (Assumption A1). This module exports:
 *
 *   - previousScheduledInstant(schedule, now) — the most recent instant on or
 *     before `now` that matches the schedule, as a local YYYY-MM-DD-HH-mm stamp.
 *     CALENDAR-FIELD math on a local Date (never ms subtraction) so it is
 *     DST-safe across the two Europe/Amsterdam transitions (design §3.2).
 *   - withinLookback(dueInstant, now, lookbackMinutes) — true when `now` is at
 *     most `lookbackMinutes` after the due instant (bounded catch-up, §3.3).
 *   - isDue(schedule, now, lookbackMinutes) — {due, dueInstant}; due is true only
 *     when withinLookback AND schedule.last_run_at !== dueInstant (A4 guard).
 *   - startScheduler(db) — the 30 s evaluation loop that enqueues owed jobs and
 *     runs the low-frequency output prune.
 */
// Service requires are LAZY (inside startScheduler) on purpose: those modules
// open the api write handle at load time, so a top-level require would open the
// DB merely to import the pure helpers (previousScheduledInstant / withinLookback
// / isDue), which the unit tests import without a DB. Deferring the require keeps
// the pure helpers DB-free and side-effect-free on import.

/** Default bounded catch-up window, in minutes (design §3.3). */
const LOOKBACK_MIN = 3;

/** Scheduler evaluation cadence, in milliseconds (design §3.1). */
const EVAL_INTERVAL_MS = 30 * 1000;

/** Two-digit zero-pad for the local stamp fields. */
function pad2(n) {
    return String(n).padStart(2, '0');
}

/**
 * Format a local Date as a minute-granular YYYY-MM-DD-HH-mm stamp. Uses local
 * getters (container TZ=Europe/Amsterdam), matching the recorder/filename
 * local-time convention.
 */
function formatInstant(date) {
    return (
        `${date.getFullYear()}-` +
        `${pad2(date.getMonth() + 1)}-` +
        `${pad2(date.getDate())}-` +
        `${pad2(date.getHours())}-` +
        `${pad2(date.getMinutes())}`
    );
}

/**
 * The most recent scheduled instant at or before `now`, as a local stamp
 * (design §3.2). Calendar-field stepping (setHours/setDate with the delta) keeps
 * the wall-clock HH:MM stable across a DST boundary — a fixed-ms step would land
 * an hour off on the 23 h / 25 h transition days.
 */
function previousScheduledInstant(schedule, now) {
    const { frequency } = schedule;

    if (frequency === 'hourly') {
        // Candidate = now's hour at the configured minute; step back one hour if
        // that is still in the future.
        const candidate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            now.getHours(),
            schedule.minute,
            0,
            0
        );
        if (candidate > now) {
            candidate.setHours(candidate.getHours() - 1);
        }
        return formatInstant(candidate);
    }

    if (frequency === 'daily') {
        // Candidate = today at the configured HH:MM; step back one day if future.
        const candidate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            schedule.hour,
            schedule.minute,
            0,
            0
        );
        if (candidate > now) {
            candidate.setDate(candidate.getDate() - 1);
        }
        return formatInstant(candidate);
    }

    if (frequency === 'weekly') {
        // Candidate = today at the configured HH:MM; walk back one day at a time
        // until it is on or before `now` AND lands on the configured weekday.
        // At most 7 iterations (0=Sunday..6=Saturday, Date.getDay() convention).
        const candidate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            schedule.hour,
            schedule.minute,
            0,
            0
        );
        let guard = 0;
        while (
            (candidate > now || candidate.getDay() !== schedule.day_of_week) &&
            guard < 8
        ) {
            candidate.setDate(candidate.getDate() - 1);
            guard += 1;
        }
        return formatInstant(candidate);
    }

    throw new Error(`unknown schedule frequency: ${frequency}`);
}

/**
 * True when `now` is no more than `lookbackMinutes` after the due instant — the
 * bounded catch-up test (design §3.3). The due instant is a local stamp, so it
 * is re-parsed as a local Date for the comparison.
 */
function withinLookback(dueInstant, now, lookbackMinutes) {
    const [y, mo, d, h, mi] = dueInstant.split('-').map(Number);
    const dueDate = new Date(y, mo - 1, d, h, mi, 0, 0);
    const deltaMs = now.getTime() - dueDate.getTime();
    if (deltaMs < 0) {
        return false;
    }
    return deltaMs <= lookbackMinutes * 60 * 1000;
}

/**
 * Decide whether a schedule is owed right now (design §3.3). Returns
 * {due, dueInstant}: due is true only when the most-recent instant is within the
 * lookback window AND it has not already been enqueued (last_run_at guard, A4).
 */
function isDue(schedule, now, lookbackMinutes) {
    const dueInstant = previousScheduledInstant(schedule, now);
    const due =
        withinLookback(dueInstant, now, lookbackMinutes) &&
        schedule.last_run_at !== dueInstant;
    return { due, dueInstant };
}

/**
 * Start the api-hosted scheduler loop (design §3.1). Every 30 s it reads the
 * schedule rows fresh (so a UI change takes effect without a restart — FR-3.4),
 * enqueues a pending job for each enabled schedule that is owed, records the
 * due instant via markScheduleRun (A4 no-double-enqueue guard), and runs the
 * low-frequency job-output prune. A thrown error in one evaluation is caught and
 * logged so the loop keeps running. Returns the interval handle.
 */
function startScheduler(db) {
    const { listSchedules, markScheduleRun } = require('../services/schedules');
    const { enqueueJob, pruneJobOutput } = require('../services/jobs');
    const {
        getConfig,
        parseOutputRetentionCount,
    } = require('../services/app-config');

    function evaluate() {
        try {
            const now = new Date();
            for (const schedule of listSchedules()) {
                if (schedule.enabled !== 1) {
                    continue;
                }
                const { due, dueInstant } = isDue(schedule, now, LOOKBACK_MIN);
                if (due) {
                    enqueueJob(schedule.type, 'schedule');
                    markScheduleRun(schedule.type, dueInstant);
                    console.log(
                        `scheduler: enqueued ${schedule.type} for due instant ${dueInstant}`
                    );
                }
            }

            // Low-frequency output prune (design §6.5). Read the retention count
            // defensively through parseOutputRetentionCount (positive-int, falls
            // back to 100 on missing/invalid — NIT-5).
            const retentionCount = parseOutputRetentionCount(
                getConfig('output_retention_count')
            );
            pruneJobOutput(retentionCount);
        } catch (err) {
            console.error('scheduler: evaluation failed:', err);
        }
    }

    // Run once immediately, then on the fixed cadence.
    evaluate();
    const handle = setInterval(evaluate, EVAL_INTERVAL_MS);
    if (typeof handle.unref === 'function') {
        handle.unref();
    }
    return handle;
}

module.exports = {
    startScheduler,
    previousScheduledInstant,
    withinLookback,
    isDue,
    LOOKBACK_MIN,
};
