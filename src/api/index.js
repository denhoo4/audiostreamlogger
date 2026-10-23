const express = require('express');
const session = require('express-session');

const app = express();
// Internal-only service: nginx reverse-proxies /api, /util and /auth to this
// port. It is never published to the host, so there is no host PORT mapping.
const PORT = process.env.APP_PORT || 3000;

/*
 --------- --------- --------- Bootstrap (design §2.4) --------- --------- ---------
 Order is critical: open DB -> schema -> seed must all succeed before the server
 accepts traffic. A failure here is fatal and unrecoverable (consistent with how
 the workers treat an unreadable settings file), so we log and exit(1).
*/
let db;
try {
    db = require('./db'); // (1) opens /usr/src/app/data/app.db + sets PRAGMAs
    const { applySchema } = require('./db/schema');
    const { seedJobConfig } = require('./db/seed-jobconfig');
    const { seedAdmin } = require('./db/seed');
    applySchema(db); // (2) CREATE TABLE IF NOT EXISTS ...
    seedJobConfig(db); // (3) synchronous insert-if-absent schedule/config seed (NIT-4)
    // (3b) One-time recordings reconcile scan (design_decisions.backfill_owner).
    // Wrapped so a scan error only logs and never blocks startup.
    try {
        const { runBackfill } = require('./services/recordings-backfill');
        runBackfill(db);
    } catch (err) {
        console.error('api: recordings backfill scan failed (non-fatal):', err);
    }
    // (4) seedAdmin is async (argon2); await it before listening.
    seedAdmin(db)
        .then(startServer)
        .catch((err) => {
            console.error('api: fatal — admin seed failed:', err);
            process.exit(1);
        });
} catch (err) {
    console.error('api: fatal — DB init/schema failed:', err);
    process.exit(1);
}

function startServer() {
    // (5) Session secret with an explicit empty/whitespace guard: compose injects
    // an unset host variable as the empty string, so a bare `||` would still pass
    // '' through — trim-check it and fall back deterministically with a warning.
    const DEV_FALLBACK = 'dev-insecure-session-secret-change-me';
    const raw = process.env.SESSION_SECRET;
    const secret = raw && raw.trim() ? raw : DEV_FALLBACK;
    if (secret === DEV_FALLBACK) {
        console.warn(
            'auth: SESSION_SECRET not set (or empty) — using insecure dev fallback; set SESSION_SECRET in production.'
        );
    }

    // Server-side SQLite-backed store over the same DB handle (design §2.8
    // fallback: node:sqlite dropped better-sqlite3-session-store, so this store
    // is hand-rolled). LOCKED options keep the DB a single infrequent writer
    // (NFR-1): resave:false, saveUninitialized:false, rolling:false.
    const SqliteStore = require('./auth/session-store')(session);
    app.use(
        session({
            store: new SqliteStore({
                client: db,
                expired: { clear: true, intervalMs: 15 * 60 * 1000 },
            }),
            secret,
            resave: false,
            saveUninitialized: false,
            rolling: false,
            cookie: {
                httpOnly: true,
                sameSite: 'lax',
                secure: process.env.COOKIE_SECURE === 'true',
                maxAge: 7 * 24 * 60 * 60 * 1000, // ~7 days
            },
        })
    );

    // (6) Single global body parser with a limit, mounted BEFORE any router so
    // exactly one parser runs on every route (util.js no longer mounts its own).
    app.use(express.json({ limit: '100kb' }));

    // (7) Mount routers. Served same-origin behind nginx, so no CORS middleware.
    const authRouter = require('./routes/auth');
    const apiRouter = require('./routes/api');
    const jobsRouter = require('./routes/jobs');
    const brandingRouter = require('./routes/branding');
    const backupRouter = require('./routes/backup');
    const utilRouter = require('./routes/util');
    app.use('/auth', authRouter);
    app.use('/api', apiRouter);
    app.use('/api/jobs', jobsRouter);
    app.use('/api/analysis', require('./routes/analysis'));
    app.use('/api/branding', brandingRouter);
    app.use('/api/backup', backupRouter);
    app.use('/util', utilRouter);

    // Lightweight liveness probe for the compose healthcheck: plain 200 JSON.
    app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

    // (8) Start the DB-driven scheduler AFTER the routers are mounted (NIT-4):
    // a scheduler failure must never block the HTTP server from coming up, and
    // the scheduler reads schedules fresh each tick so a UI change takes effect
    // without a restart (design §3.1, FR-3.4).
    const { startScheduler } = require('./scheduler');
    startScheduler(db);

    // (9) Start the server.
    app.listen(PORT, () => {
        console.log(`API service is running on port ${PORT}`);
    });
}
