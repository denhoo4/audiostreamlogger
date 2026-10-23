/**
 * Generic worker service (design §2).
 *
 * Boot: write /tmp/heartbeat, open the RW handle (bounded SQLITE_BUSY retry so a
 * not-yet-ready DB is tolerated), run the boot stale-`running` reclaim, log a
 * greppable "worker OK". Then start TWO INDEPENDENT timers:
 *   - a heartbeat setInterval(5000) NOT coupled to the tick body, so it keeps
 *     firing in the gaps between a running handler's per-file synchronous calls
 *     and does not go stale while a legitimate job makes progress (§2.3/§2.7);
 *   - a setTimeout-driven poll loop (POLL_MS=3000), non-overlapping: the next
 *     tick is scheduled in a finally only after the current one returns.
 *
 * Each tick: read all pending oldest-first, planTick, apply skip-then-claim, run
 * the claimed handler synchronously, then writeTerminal with capped output.
 */
const fs = require('fs');
const { openDb, withBusyRetry, sleepSync } = require('./db');
const { planTick, applyPlan } = require('./claim');
const { runCleaner } = require('./handlers/cleaner');
const { runPeakfileGenerator } = require('./handlers/peakfilegenerator');

const HEARTBEAT = '/tmp/heartbeat';
const HEARTBEAT_MS = 5000;
const POLL_MS = 3000;
const OUTPUT_CAP_BYTES = 65536; // 64 KiB
const TERMINAL_MAX_ATTEMPTS = 5;
const TERMINAL_SLEEP_MS = 200;

const HANDLERS = {
    cleaner: runCleaner,
    peakfilegenerator: runPeakfileGenerator,
};

function writeHeartbeat() {
    try {
        fs.writeFileSync(HEARTBEAT, new Date().toISOString());
    } catch (err) {
        console.error('worker: failed to write heartbeat:', err.message);
    }
}

// Module-level id of the job currently being executed (null when idle). Set in
// runClaimedJob before the handler runs and cleared in its finally, so the 5s
// status timer can report 'running'/'idle' + the live job id without coupling
// to the tick body.
let currentJobId = null;

/**
 * Best-effort status report into app_config (design: FEAT-002). UPSERTs
 * worker_last_heartbeat / worker_status / worker_current_job_id over the
 * worker's own RW handle, each inside withBusyRetry, all wrapped in try/catch so
 * a contended or failed status write only logs and NEVER crashes the worker. The
 * /tmp/heartbeat file write (compose healthcheck) stays separate and intact.
 */
function writeWorkerStatus(db, { status, currentJobId }) {
    try {
        const upsert = db.prepare(
            'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );
        withBusyRetry(() => upsert.run('worker_last_heartbeat', new Date().toISOString()));
        withBusyRetry(() => upsert.run('worker_status', status));
        withBusyRetry(() =>
            upsert.run('worker_current_job_id', currentJobId == null ? '' : String(currentJobId))
        );
    } catch (err) {
        console.error('worker: failed to write status:', err.message);
    }
}

/**
 * Keep the last OUTPUT_CAP_BYTES bytes of `output`, prefixed with a truncation
 * marker. Operates on a UTF-8 Buffer so the budget is byte-exact; the tail is
 * decoded with a lenient TextDecoder so a split leading multi-byte sequence is
 * dropped rather than rendered as a broken character (design §2.5).
 */
function capOutput(output) {
    const buf = Buffer.from(output, 'utf8');
    if (buf.length <= OUTPUT_CAP_BYTES) return output;
    let start = buf.length - OUTPUT_CAP_BYTES;
    // The byte cut may land inside a multi-byte sequence. Advance past any
    // UTF-8 continuation bytes (0b10xxxxxx) so the retained tail begins on a
    // whole code point — the split leading sequence is dropped, not rendered as
    // a broken U+FFFD mid-word (design §2.5).
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) {
        start += 1;
    }
    const decoded = new TextDecoder('utf-8').decode(buf.subarray(start));
    return '…[output truncated; showing last 64 KiB]\n' + decoded;
}

/**
 * Terminal transition with its own bounded SQLITE_BUSY retry (distinct from the
 * generic tick try/catch): this write MUST land, or the row stays `running` and
 * every later job is skipped until a restart. The boot reclaim is the backstop
 * if all attempts are ultimately lost.
 */
function writeTerminal(db, id, status, output) {
    for (let attempt = 0; attempt < TERMINAL_MAX_ATTEMPTS; attempt++) {
        try {
            db.prepare(
                "UPDATE jobs SET status=?, output=?, finished_at=datetime('now') WHERE id=?"
            ).run(status, output, id);
            return;
        } catch (err) {
            if (!/SQLITE_BUSY/i.test(err.message) || attempt === TERMINAL_MAX_ATTEMPTS - 1) {
                throw err;
            }
            sleepSync(TERMINAL_SLEEP_MS);
        }
    }
}

/**
 * Boot stale-lock reclaim: any row left `running` from a previous worker that
 * was killed mid-job is marked failed so the single-running invariant holds
 * across a restart.
 */
function reclaimStaleRunning(db) {
    const result = withBusyRetry(() =>
        db
            .prepare(
                "UPDATE jobs SET status='failed', output='worker restarted mid-job', finished_at=datetime('now') WHERE status='running'"
            )
            .run()
    );
    if (result.changes > 0) {
        console.error(
            `worker: reclaimed ${result.changes} stale running job(s) on boot`
        );
    }
}

/** Run the handler for a claimed job and write its terminal status. */
function runClaimedJob(db, job) {
    const handler = HANDLERS[job.type];
    if (handler === undefined) {
        writeTerminal(
            db,
            job.id,
            'failed',
            capOutput(`unknown job type: ${job.type}`)
        );
        console.error(`worker: job ${job.id} (${job.type}) failed: unknown type`);
        return;
    }
    // Track the live job id so the 5s status timer reports 'running' + this id;
    // always cleared in the finally even if the handler throws.
    currentJobId = job.id;
    try {
        const output = handler(db);
        writeTerminal(db, job.id, 'done', capOutput(output));
    } catch (err) {
        writeTerminal(db, job.id, 'failed', capOutput(String(err && err.stack ? err.stack : err)));
        console.error(`worker: job ${job.id} (${job.type}) failed: ${err.message}`);
    } finally {
        currentJobId = null;
    }
}

/** One poll tick: claim oldest pending, skip the rest, run the claimed job. */
function tickOnce(db) {
    const pending = db
        .prepare(
            "SELECT id, type, trigger_source, status, created_at FROM jobs WHERE status='pending' ORDER BY created_at, id"
        )
        .all();
    if (pending.length === 0) return;

    const plan = planTick({ pending });
    const claimedId = applyPlan(db, plan);
    if (claimedId === null) return; // lost the claim race; retry next tick

    const job = pending.find((j) => j.id === claimedId);
    runClaimedJob(db, job);
}

function start() {
    writeHeartbeat();
    const db = openDb();
    reclaimStaleRunning(db);
    console.log('worker OK');

    // Independent heartbeat timer — never coupled to the tick body. It writes
    // the /tmp/heartbeat file (compose healthcheck) AND a best-effort app_config
    // status row (status derived from whether a job is currently running).
    setInterval(() => {
        writeHeartbeat();
        writeWorkerStatus(db, {
            status: currentJobId === null ? 'idle' : 'running',
            currentJobId,
        });
    }, HEARTBEAT_MS);

    // Non-overlapping poll loop.
    function loop() {
        try {
            tickOnce(db);
        } catch (err) {
            console.error('worker: tick error:', err.message);
        } finally {
            setTimeout(loop, POLL_MS);
        }
    }
    loop();
}

// Only auto-start when run as the entrypoint; requiring the module (tests) does not.
if (require.main === module) {
    start();
}

module.exports = {
    capOutput,
    writeTerminal,
    reclaimStaleRunning,
    runClaimedJob,
    tickOnce,
    writeWorkerStatus,
    OUTPUT_CAP_BYTES,
};
