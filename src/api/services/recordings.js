/**
 * Recordings data-access + pure analysis helpers — FEAT-001.
 *
 * Grain: ONE row per (stream_folder, date, hour) hour-slot (design_decisions
 * .table_grain); .partN segments fold into that one row via segment_count +
 * aggregate size_bytes/duration_seconds. stream_folder is the stable on-disk key.
 *
 * The DB-backed functions mirror services/jobs.js: they bind to the api's single
 * write handle via `require('../db')`, while `upsertRecording(db, ...)` accepts an
 * injected handle so the temp-DB test pattern works against it directly.
 *
 * The analysis helpers (expectedHourSlots / missingSlots / aggregateByStream) are
 * PURE — no fs, no DB — so node:test covers them without a database.
 */
const db = require('../db');

const RECORDING_COLUMNS =
    'id, stream_folder, date, hour, file_path, status, duration_seconds, size_bytes, segment_count, created_at, updated_at';

/* ------------------------------------------------------------------ *
 * Pure analysis helpers (no fs/DB)
 * ------------------------------------------------------------------ */

/** Pad an hour integer 0..23 to the two-char 'HH' string used on disk/in rows. */
function padHour(h) {
    return String(h).padStart(2, '0');
}

/**
 * Every hourly slot in the inclusive date range [startDate, endDate], returned
 * as an array of { date ('YYYY-MM-DD'), hour ('HH') } ordered chronologically.
 * Each day contributes 24 slots (00..23). Inputs are 'YYYY-MM-DD' strings; an
 * endDate before startDate yields []. Dates are walked in UTC so no DST/offset
 * drift creeps into the slot count.
 */
function expectedHourSlots(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return [];
    }

    const slots = [];
    for (
        let d = new Date(start);
        d.getTime() <= end.getTime();
        d.setUTCDate(d.getUTCDate() + 1)
    ) {
        const date = d.toISOString().slice(0, 10);
        for (let h = 0; h < 24; h += 1) {
            slots.push({ date, hour: padHour(h) });
        }
    }
    return slots;
}

/**
 * The expected slots that have no matching present row, keyed on (date, hour).
 * `presentRows` is any array of objects carrying `date` + `hour`. Returned in
 * the same order as `expectedSlots`.
 */
function missingSlots(expectedSlots, presentRows) {
    const present = new Set(
        (presentRows || []).map((r) => `${r.date}|${r.hour}`)
    );
    return (expectedSlots || []).filter(
        (slot) => !present.has(`${slot.date}|${slot.hour}`)
    );
}

/**
 * Fold recording rows into one summary object per stream_folder:
 *   { stream_folder, total_hours, storage_bytes, recording_count,
 *     avg_duration_seconds, earliest, latest }
 * where total_hours == recording_count (one row per hour-slot), storage_bytes is
 * the summed size_bytes (nulls treated as 0), avg_duration_seconds is the mean of
 * the non-null duration_seconds (null when none are known), and earliest/latest
 * are the min/max 'YYYY-MM-DD-HH' slot keys. Pure: it does not touch the DB.
 */
function aggregateByStream(rows) {
    const byStream = new Map();

    for (const row of rows || []) {
        let agg = byStream.get(row.stream_folder);
        if (!agg) {
            agg = {
                stream_folder: row.stream_folder,
                total_hours: 0,
                storage_bytes: 0,
                recording_count: 0,
                _durationSum: 0,
                _durationCount: 0,
                earliest: null,
                latest: null,
            };
            byStream.set(row.stream_folder, agg);
        }

        agg.recording_count += 1;
        agg.total_hours += 1;
        agg.storage_bytes += Number(row.size_bytes) || 0;
        if (row.duration_seconds !== null && row.duration_seconds !== undefined) {
            agg._durationSum += Number(row.duration_seconds);
            agg._durationCount += 1;
        }

        const key = `${row.date}-${row.hour}`;
        if (agg.earliest === null || key < agg.earliest) {
            agg.earliest = key;
        }
        if (agg.latest === null || key > agg.latest) {
            agg.latest = key;
        }
    }

    return Array.from(byStream.values()).map((agg) => ({
        stream_folder: agg.stream_folder,
        total_hours: agg.total_hours,
        storage_bytes: agg.storage_bytes,
        recording_count: agg.recording_count,
        avg_duration_seconds:
            agg._durationCount > 0 ? agg._durationSum / agg._durationCount : null,
        earliest: agg.earliest,
        latest: agg.latest,
    }));
}

/* ------------------------------------------------------------------ *
 * DB data-access
 * ------------------------------------------------------------------ */

/**
 * Insert or update the single hour-slot row keyed on (stream_folder, date, hour).
 * On conflict it refreshes file_path/status/duration/size/segment_count and bumps
 * updated_at, so a re-scan or a later segment write is idempotent on the key.
 * Accepts an injected `handle` so tests can bind a temp DB directly.
 */
function upsertRecording(handle, rec) {
    return handle
        .prepare(
            `INSERT INTO recordings
               (stream_folder, date, hour, file_path, status, duration_seconds, size_bytes, segment_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (stream_folder, date, hour) DO UPDATE SET
               file_path        = excluded.file_path,
               status           = excluded.status,
               duration_seconds = excluded.duration_seconds,
               size_bytes       = excluded.size_bytes,
               segment_count    = excluded.segment_count,
               updated_at       = datetime('now')`
        )
        .run(
            rec.stream_folder,
            rec.date,
            rec.hour,
            rec.file_path,
            rec.status,
            rec.duration_seconds ?? null,
            rec.size_bytes ?? null,
            rec.segment_count ?? 1
        );
}

/** All recording rows, ordered by stream then slot. */
function listAll() {
    return db
        .prepare(
            `SELECT ${RECORDING_COLUMNS} FROM recordings
             ORDER BY stream_folder, date, hour`
        )
        .all();
}

/**
 * Recording rows for one folder whose `date` falls in the inclusive range
 * [start, end] ('YYYY-MM-DD'), ordered by slot.
 */
function listByStreamAndRange(folder, start, end) {
    return db
        .prepare(
            `SELECT ${RECORDING_COLUMNS} FROM recordings
             WHERE stream_folder = ? AND date >= ? AND date <= ?
             ORDER BY date, hour`
        )
        .all(folder, start, end);
}

/**
 * All recording rows whose `date` falls in the inclusive range [start, end]
 * ('YYYY-MM-DD'), across every folder, ordered by stream then slot. Used by the
 * stream-health endpoint, whose window may straddle two calendar dates; reuses
 * the idx_recordings_date index. (listByStreamAndRange is single-folder, so a
 * cross-folder date-range reader is the minimal addition here.)
 */
function listRecentByDate(startDate, endDate) {
    return db
        .prepare(
            `SELECT ${RECORDING_COLUMNS} FROM recordings
             WHERE date >= ? AND date <= ?
             ORDER BY stream_folder, date, hour`
        )
        .all(startDate, endDate);
}

/**
 * Indexed SQL aggregates grouped by stream_folder plus an overall roll-up:
 *   { per_stream: [{ stream_folder, total_hours, storage_bytes,
 *                    recording_count, avg_duration_seconds, earliest, latest }],
 *     overall:    { total_hours, storage_bytes, recording_count,
 *                   avg_duration_seconds, earliest, latest, stream_count } }
 * Shapes match aggregateByStream so the two are interchangeable for the router.
 */
function summarize() {
    const perStream = db
        .prepare(
            `SELECT
               stream_folder,
               COUNT(*)                         AS total_hours,
               COALESCE(SUM(size_bytes), 0)     AS storage_bytes,
               COUNT(*)                         AS recording_count,
               AVG(duration_seconds)            AS avg_duration_seconds,
               MIN(date || '-' || hour)         AS earliest,
               MAX(date || '-' || hour)         AS latest
             FROM recordings
             GROUP BY stream_folder
             ORDER BY stream_folder`
        )
        .all();

    const overall = db
        .prepare(
            `SELECT
               COUNT(*)                            AS total_hours,
               COALESCE(SUM(size_bytes), 0)        AS storage_bytes,
               COUNT(*)                            AS recording_count,
               AVG(duration_seconds)               AS avg_duration_seconds,
               MIN(date || '-' || hour)            AS earliest,
               MAX(date || '-' || hour)            AS latest,
               COUNT(DISTINCT stream_folder)       AS stream_count
             FROM recordings`
        )
        .get();

    return { per_stream: perStream, overall };
}

module.exports = {
    // pure helpers
    expectedHourSlots,
    missingSlots,
    aggregateByStream,
    // data-access
    upsertRecording,
    listAll,
    listByStreamAndRange,
    listRecentByDate,
    summarize,
};
