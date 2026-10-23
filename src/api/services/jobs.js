/**
 * Jobs data-access layer over the api's single write handle (node:sqlite
 * DatabaseSync) — design §1.4.
 *
 * The api is the sole writer of NEW job rows (manual "Run now" + the scheduler),
 * so enqueue/prune live here. The worker flips only the status of the one job it
 * is executing over its own handle (design §2.1) and never prunes.
 */
const db = require('../db');

const JOB_COLUMNS =
    'id, type, trigger_source, status, output, created_at, started_at, finished_at';

/**
 * Insert a pending job of the given type and trigger source, returning the
 * created row. The type/trigger_source CHECK constraints backstop invalid
 * values at the DB layer.
 */
function enqueueJob(type, triggerSource) {
    const result = db
        .prepare('INSERT INTO jobs (type, trigger_source) VALUES (?, ?)')
        .run(type, triggerSource);
    return getJob(Number(result.lastInsertRowid));
}

/** Most-recent jobs first (created_at DESC, id DESC), capped at `limit`. */
function listRecentJobs(limit) {
    return db
        .prepare(
            `SELECT ${JOB_COLUMNS} FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?`
        )
        .all(limit);
}

/** Fetch a single job by id, or undefined. */
function getJob(id) {
    return db
        .prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`)
        .get(id);
}

/**
 * Retention prune (design §6.3): keep the newest `n` TERMINAL jobs and delete
 * older terminal rows. Both the DELETE target and the keep-set are restricted to
 * terminal statuses, so a pending/running job is never pruned — a structural
 * guarantee, not an assumption.
 */
function pruneJobOutput(n) {
    return db
        .prepare(
            `DELETE FROM jobs
              WHERE status IN ('done','failed','skipped')
                AND id NOT IN (
                  SELECT id FROM jobs
                   WHERE status IN ('done','failed','skipped')
                   ORDER BY created_at DESC, id DESC
                   LIMIT ?
                )`
        )
        .run(n);
}

module.exports = {
    enqueueJob,
    listRecentJobs,
    getJob,
    pruneJobOutput,
};
