/**
 * Recorder recordings DB handle (FEAT-002).
 *
 * The recorder opens its OWN long-lived read-write DatabaseSync against the same
 * app.db the api owns, mirroring src/worker/db.js. Like the worker it NEVER
 * issues `PRAGMA journal_mode` — the api owns the journal mode (DELETE). This
 * handle sets ONLY `busy_timeout` (+ `foreign_keys`), and both the open and
 * those PRAGMAs run INSIDE the bounded SQLITE_BUSY retry wrapper so a transient
 * lock held by the api/worker (or a not-yet-ready DB at boot) is ridden out
 * rather than crashing the recorder (the service's not-ready posture).
 *
 * This is a deliberate, bounded relaxation of "the api is the only writer": the
 * recorder writes only recordings rows for the hours it is capturing. The api
 * still owns every schema/config/stream/job write. The ./data mount for the
 * recorder is therefore now read-write (see docker-compose.yml).
 *
 * node:sqlite (DatabaseSync) only — better-sqlite3 does not compile on Node 26.
 */
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || '/usr/src/app/data/app.db';
const SERVICE_NAME = 'recorder';

// Bounded SQLITE_BUSY retry (mirrors src/worker/db.js). The DELETE journal keeps
// a single writer at a time, so another writer's brief lock can make a write
// throw SQLITE_BUSY past busy_timeout; a handful of short synchronous retries
// ride it out.
const BUSY_MAX_ATTEMPTS = 5;
const BUSY_SLEEP_MS = 200;

/**
 * Synchronous sleep via Atomics.wait on a throwaway SharedArrayBuffer (mirrors
 * the worker). A short blocking sleep between retries keeps the loop simple.
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
 * tolerated. NEVER sets journal_mode.
 */
function openDb() {
    return withBusyRetry(() => {
        const db = new DatabaseSync(DB_PATH);
        db.exec('PRAGMA busy_timeout = 5000');
        db.exec('PRAGMA foreign_keys = ON');
        return db;
    });
}

// Split a `YYYY-MM-DD-HH` stamp (currentHourStamp from time-helpers.js) into the
// table's date ('YYYY-MM-DD') + hour ('HH') columns. Returns null for a stamp
// that does not match the expected shape so a caller never writes a garbage row.
function parseStamp(stamp) {
    const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(String(stamp));
    if (!m) {
        return null;
    }
    return { date: m[1], hour: m[2] };
}

// INSERT the hour row on record start with status 'recording' and segment_count
// 1. file_path is the primary name `<folder>-<stamp>.<ext>` (segmentOutputName
// attempt 0 with the stream's resolved codec extension — FEAT-002). ext defaults
// to 'mp3' so existing callers/tests stay on today's behaviour. ON
// CONFLICT(stream_folder,date,hour) DO NOTHING so a retry/catch-up start for an
// hour already tracked never clobbers a 'partial'/'complete' row.
function upsertRecordingStart(db, { folder, stamp, ext = 'mp3' }) {
    const parts = parseStamp(stamp);
    if (!parts) {
        throw new Error(`recorder: cannot parse hour stamp ${JSON.stringify(stamp)}`);
    }
    const filePath = `${folder}-${stamp}.${ext}`;
    return withBusyRetry(() => {
        db.prepare(
            `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
             VALUES (?, ?, ?, ?, 'recording', 1)
             ON CONFLICT (stream_folder, date, hour) DO NOTHING`
        ).run(folder, parts.date, parts.hour, filePath);
    });
}

// A mid-hour segment restart (attempt >= 1) flips the hour row to 'partial' and
// sets segment_count = attempt + 1 (.part2 == attempt 1, matching
// backoff-helpers.js::segmentOutputName). Only touches an existing row for the
// hour (the start insert already created it); updated_at is bumped.
function markSegment(db, { folder, stamp, attempt }) {
    const parts = parseStamp(stamp);
    if (!parts) {
        throw new Error(`recorder: cannot parse hour stamp ${JSON.stringify(stamp)}`);
    }
    const segmentCount = (Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0) + 1;
    return withBusyRetry(() => {
        db.prepare(
            `UPDATE recordings
                SET status = 'partial',
                    segment_count = ?,
                    updated_at = datetime('now')
              WHERE stream_folder = ? AND date = ? AND hour = ?`
        ).run(segmentCount, folder, parts.date, parts.hour);
    });
}

// A normal finalize sets size_bytes and flips status to 'complete' — but NEVER
// downgrades an already-'partial' hour (a mid-hour restart happened, so the hour
// stays 'partial'). updated_at is bumped. Only touches an existing row.
function markComplete(db, { folder, stamp, sizeBytes }) {
    const parts = parseStamp(stamp);
    if (!parts) {
        throw new Error(`recorder: cannot parse hour stamp ${JSON.stringify(stamp)}`);
    }
    const size = Number.isFinite(sizeBytes) ? Math.floor(sizeBytes) : null;
    return withBusyRetry(() => {
        db.prepare(
            `UPDATE recordings
                SET status = CASE WHEN status = 'partial' THEN 'partial' ELSE 'complete' END,
                    size_bytes = ?,
                    updated_at = datetime('now')
              WHERE stream_folder = ? AND date = ? AND hour = ?`
        ).run(size, folder, parts.date, parts.hour);
    });
}

module.exports = {
    openDb,
    withBusyRetry,
    sleepSync,
    parseStamp,
    upsertRecordingStart,
    markSegment,
    markComplete,
    DB_PATH,
    SERVICE_NAME,
};
