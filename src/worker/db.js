/**
 * Worker DB handle (design §2.1, MEDIUM-1).
 *
 * The worker opens its OWN long-lived read-write DatabaseSync against the same
 * app.db the api owns. Unlike the api (src/api/db/index.js) it NEVER issues
 * `PRAGMA journal_mode` — the api owns the journal mode (DELETE). The worker
 * sets ONLY `busy_timeout` (+ `foreign_keys`), and both the open and those
 * PRAGMAs run INSIDE the bounded SQLITE_BUSY retry wrapper so a transient lock
 * held by the api (or a not-yet-ready DB at boot) is ridden out rather than
 * crashing the worker (NFR-4).
 *
 * This is a deliberate, bounded relaxation of "the api is the only writer": the
 * worker writes only the status of the single job it is executing. The ./data
 * mount for the worker is therefore read-write (the recorder stays :ro).
 *
 * node:sqlite (DatabaseSync) only — better-sqlite3 does not compile on Node 26.
 */
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || '/usr/src/app/data/app.db';

// Bounded SQLITE_BUSY retry. The DELETE journal keeps a single writer at a time,
// so the api's brief write lock can make the worker's write throw SQLITE_BUSY
// past busy_timeout; a handful of short synchronous retries ride it out.
const BUSY_MAX_ATTEMPTS = 5;
const BUSY_SLEEP_MS = 200;

/**
 * Synchronous sleep via Atomics.wait on a throwaway SharedArrayBuffer. The
 * worker's tick is synchronous within its boundary (design §2.3), so a blocking
 * sleep between retries is acceptable and keeps the retry loop simple.
 */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn`, retrying on SQLITE_BUSY up to BUSY_MAX_ATTEMPTS with a short
 * synchronous sleep between attempts. Any non-busy error (or a busy error on the
 * final attempt) is re-thrown.
 */
function withBusyRetry(fn) {
    for (let attempt = 0; attempt < BUSY_MAX_ATTEMPTS; attempt++) {
        try {
            return fn();
        } catch (err) {
            if (!/SQLITE_BUSY/i.test(err.message) || attempt === BUSY_MAX_ATTEMPTS - 1) {
                throw err;
            }
            sleepSync(BUSY_SLEEP_MS);
        }
    }
}

/**
 * Open the single read-write handle. The open + PRAGMAs run inside the busy
 * retry so a not-yet-migrated DB (api still bootstrapping) or a brief lock is
 * tolerated. NEVER sets journal_mode (MEDIUM-1).
 */
function openDb() {
    return withBusyRetry(() => {
        const db = new DatabaseSync(DB_PATH);
        db.exec('PRAGMA busy_timeout = 5000');
        db.exec('PRAGMA foreign_keys = ON');
        return db;
    });
}

module.exports = { openDb, withBusyRetry, sleepSync, DB_PATH };
