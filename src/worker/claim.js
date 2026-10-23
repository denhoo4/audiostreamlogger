/**
 * Single-job claim + busy=skip (design §2.4, FR-2.3/FR-2.4).
 *
 * The worker runs each claimed job synchronously to completion inside a tick and
 * ticks never overlap (design §2.3), so at the start of a tick nothing is
 * `running`. The busy=skip semantic is therefore evaluated across the WHOLE
 * pending set each tick: the oldest pending job is claimed and run, and every
 * other job that was pending at that instant is marked `skipped` ("skipped,
 * busy") — not deferred or serialized (FR-2.4).
 */
const { withBusyRetry } = require('./db');

/**
 * Pure tick plan. `pending` is the oldest-first list of pending job rows.
 *   []        -> { claim: null, skip: [] }   (idle)
 *   [A]       -> { claim: A,    skip: [] }    (one runs, nothing skipped)
 *   [A,B,C]   -> { claim: A,    skip: [B,C] } (A runs, B and C skipped as busy)
 */
function planTick({ pending }) {
    if (pending.length === 0) return { claim: null, skip: [] };
    const [first, ...rest] = pending;
    return { claim: first.id, skip: rest.map((j) => j.id) };
}

/**
 * Apply the plan effectfully. Skips are written FIRST so that even if the claim
 * then fails to land, the extra pendings are already resolved and will not be
 * re-run on a later tick (AC-5 "not executed later"). Every write routes through
 * withBusyRetry so a transient api lock does not drop a skip or a claim.
 *
 * Returns the claimed job id if the claim actually landed (changes === 1), else
 * null (lost a race / manual DB poke -> treat as idle, retry next tick).
 */
function applyPlan(db, plan) {
    const skipStmt = db.prepare(
        "UPDATE jobs SET status='skipped', output='skipped, busy', finished_at=datetime('now') WHERE id=? AND status='pending'"
    );
    for (const id of plan.skip) {
        withBusyRetry(() => skipStmt.run(id));
    }

    if (plan.claim === null) return null;

    const claimStmt = db.prepare(
        "UPDATE jobs SET status='running', started_at=datetime('now') WHERE id=? AND status='pending'"
    );
    const result = withBusyRetry(() => claimStmt.run(plan.claim));
    return result.changes === 0 ? null : plan.claim;
}

module.exports = { planTick, applyPlan };
