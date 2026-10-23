/**
 * /api/jobs routes: job control, scheduler config, log-retention config, and
 * the live SSE job stream (design §6.1/§6.2). EVERYTHING in this router is behind
 * requireAuth (AC-7) — the public GET /api/settings + /api/settings2 live in
 * routes/api.js and stay unauthenticated (AC-10).
 *
 * Validation failures return 400 {error, field}; DB errors are caught, logged,
 * and returned as 500 {error: 'Internal Server Error: …'} exactly like the
 * existing api.js routes so the frontend's ApiError plumbing surfaces them
 * unchanged.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const {
    enqueueJob,
    listRecentJobs,
    getJob,
    pruneJobOutput,
} = require('../services/jobs');
const {
    listSchedules,
    getSchedule,
    updateSchedule,
    ScheduleValidationError,
} = require('../services/schedules');
const {
    getConfig,
    setConfig,
    parseOutputRetentionCount,
    ConfigValidationError,
} = require('../services/app-config');
const { validateRetentionHours } = require('../lib/config-validate');

const JOB_TYPES = ['cleaner', 'peakfilegenerator'];

/**
 * Prune job output using the configured retention count, read defensively
 * through parseOutputRetentionCount (positive-int, falls back to 100 on
 * missing/invalid — NIT-5). Runs after each manual enqueue so output never grows
 * unbounded regardless of who created the jobs (design §6.3). A prune failure is
 * logged but never fails the enqueue response.
 */
function pruneAfterEnqueue() {
    try {
        pruneJobOutput(parseOutputRetentionCount(getConfig('output_retention_count')));
    } catch (err) {
        console.error('Error pruning job output:', err);
    }
}

// GET /api/jobs?limit=50 (requireAuth) — recent jobs, newest first. `limit` is
// an optional integer 1..200 (default 50); out-of-range -> 400.
router.get('/', requireAuth, (req, res) => {
    let limit = 50;
    if (req.query.limit !== undefined) {
        const raw = Number(req.query.limit);
        if (!Number.isInteger(raw) || raw < 1 || raw > 200) {
            return res
                .status(400)
                .json({ error: 'invalid limit', field: 'limit' });
        }
        limit = raw;
    }

    try {
        return res.json(listRecentJobs(limit));
    } catch (err) {
        console.error('Error listing jobs:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// POST /api/jobs {type} (requireAuth) — the "Run now" trigger. Enqueues a manual
// pending job and returns the created row (201). `type` must be a known job type.
router.post('/', requireAuth, (req, res) => {
    const body = req.body || {};
    if (!JOB_TYPES.includes(body.type)) {
        return res.status(400).json({ error: 'invalid type', field: 'type' });
    }

    try {
        const created = enqueueJob(body.type, 'manual');
        pruneAfterEnqueue();
        return res.status(201).json(created);
    } catch (err) {
        console.error('Error enqueuing job:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/schedules (requireAuth) — all schedule rows.
router.get('/schedules', requireAuth, (req, res) => {
    try {
        return res.json(listSchedules());
    } catch (err) {
        console.error('Error listing schedules:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// PUT /api/schedules/:type (requireAuth) — update a schedule. Unknown type ->
// 404; per-field validation failures -> 400 {error, field}.
router.put('/schedules/:type', requireAuth, (req, res) => {
    const { type } = req.params;
    if (!JOB_TYPES.includes(type)) {
        return res.status(404).json({ error: 'schedule not found' });
    }

    const body = req.body || {};
    try {
        const updated = updateSchedule(type, {
            enabled: body.enabled,
            frequency: body.frequency,
            minute: body.minute,
            hour: body.hour,
            day_of_week: body.day_of_week,
        });
        if (!updated) {
            return res.status(404).json({ error: 'schedule not found' });
        }
        return res.json(updated);
    } catch (err) {
        if (err instanceof ScheduleValidationError) {
            return res.status(400).json({ error: err.error, field: err.field });
        }
        console.error('Error updating schedule:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/config/log_retention (requireAuth) — current retention hours.
router.get('/config/log_retention', requireAuth, (req, res) => {
    try {
        const stored = getConfig('log_retention');
        return res.json({ hours: stored === undefined ? null : Number(stored) });
    } catch (err) {
        console.error('Error reading log_retention:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// PUT /api/config/log_retention {hours} (requireAuth) — set retention hours;
// reuses validateRetentionHours (1..8760). Invalid -> 400 {error, field:'hours'}.
router.put('/config/log_retention', requireAuth, (req, res) => {
    const body = req.body || {};
    const hours = Number(body.hours);
    const result = validateRetentionHours(hours);
    if (!result.ok) {
        return res.status(400).json({ error: result.message, field: 'hours' });
    }

    try {
        setConfig('log_retention', hours);
        return res.json({ hours });
    } catch (err) {
        if (err instanceof ConfigValidationError) {
            return res.status(400).json({ error: err.error, field: 'hours' });
        }
        console.error('Error setting log_retention:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/jobs/stream (requireAuth) — Server-Sent Events live job feed
// (design §6.2). The api cannot get push callbacks from SQLite, so this handler
// polls the DB every ~1 s on its own timer and diffs against the last snapshot it
// sent on THIS connection, emitting:
//   event: snapshot — on connect (the current recent-jobs list).
//   event: job      — the full row whenever a row's status/output/timestamps
//                     changed since the last poll.
//   event: ping     — every 15 s keep-alive.
// The poll is read-only and never holds the write lock (NFR-5). On req 'close'
// both timers are cleared and the response ended so nothing leaks.
const SSE_POLL_MS = 1000;
const SSE_PING_MS = 15 * 1000;
const SSE_LIMIT = 50;

router.get('/stream', requireAuth, (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Snapshot keyed by id -> a stable signature of the fields the viewer cares
    // about; a changed signature on a later poll emits a `job` event.
    let lastSig = new Map();

    function signature(row) {
        return `${row.status}|${row.output}|${row.started_at}|${row.finished_at}`;
    }

    function send(event, payload) {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

    // Initial snapshot so the client renders immediately.
    try {
        const rows = listRecentJobs(SSE_LIMIT);
        for (const row of rows) {
            lastSig.set(row.id, signature(row));
        }
        send('snapshot', rows);
    } catch (err) {
        console.error('Error sending job snapshot:', err);
    }

    const pollTimer = setInterval(() => {
        try {
            const rows = listRecentJobs(SSE_LIMIT);
            const seen = new Map();
            for (const row of rows) {
                const sig = signature(row);
                seen.set(row.id, sig);
                if (lastSig.get(row.id) !== sig) {
                    send('job', row);
                }
            }
            lastSig = seen;
        } catch (err) {
            console.error('Error polling jobs for SSE:', err);
        }
    }, SSE_POLL_MS);

    const pingTimer = setInterval(() => {
        res.write(': ping\n\n');
    }, SSE_PING_MS);

    req.on('close', () => {
        clearInterval(pollTimer);
        clearInterval(pingTimer);
        res.end();
    });
});

module.exports = router;
