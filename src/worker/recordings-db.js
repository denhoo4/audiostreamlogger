/**
 * Worker-side writes to the shared `recordings` table (FEAT-003).
 *
 * The api owns the schema + config/stream/job writes; the worker owns ONLY the
 * per-file metadata it discovers while processing (duration_seconds/size_bytes)
 * and the removal of a row when the cleaner unlinks its file. Both run over the
 * worker's own RW handle (src/worker/db.js) and are wrapped in withBusyRetry so
 * the api's brief write lock is ridden out (MEDIUM-1 / NFR-4).
 *
 * Row grain matches FEAT-001: one row per (stream_folder, date, hour) hour-slot.
 * A `.partN` segment folds into the same hour row. The stamp is the recorder's
 * `YYYY-MM-DD-HH` local stamp; here it is split into `date` ('YYYY-MM-DD') and
 * `hour` ('HH') to match the table's two columns.
 */
const { withBusyRetry } = require('./db');

// Split a 'YYYY-MM-DD-HH' stamp into { date, hour } matching the recordings
// table columns, or null when the stamp is not the expected shape.
function splitStamp(stamp) {
    if (typeof stamp !== 'string') {
        return null;
    }
    const match = stamp.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }
    return { date: match[1], hour: match[2] };
}

/**
 * Fill duration_seconds + size_bytes on the (stream_folder,date,hour) row.
 *
 * - If the row exists: UPDATE its duration_seconds/size_bytes/updated_at. When
 *   `part` > 1 (a mid-hour `.partN` segment) also mark status 'partial' and
 *   bump segment_count so the hour reflects the restart.
 * - If no row exists yet (the recorder has not written one, or backfill has not
 *   run): INSERT one with status 'partial' for a `.partN` else 'complete',
 *   segment_count = part, and file_path `${folder}/${folder}-${stamp}.${ext}`
 *   (ext is the real codec extension, default 'mp3'). `ext` is consulted ONLY on
 *   the INSERT branch; the UPDATE branches key on (folder,date,hour) only.
 *
 * Returns true when a row was written. Throws only on a non-busy DB error.
 */
function upsertRecordingMeta(db, { folder, stamp, durationSeconds, sizeBytes, part, ext = 'mp3' }) {
    const split = splitStamp(stamp);
    if (split === null) {
        return false;
    }
    const { date, hour } = split;
    const segment = typeof part === 'number' && part > 1 ? part : 1;
    const duration = durationSeconds == null ? null : durationSeconds;
    const size = sizeBytes == null ? null : sizeBytes;

    return withBusyRetry(() => {
        const existing = db
            .prepare(
                'SELECT id FROM recordings WHERE stream_folder = ? AND date = ? AND hour = ?'
            )
            .get(folder, date, hour);

        if (existing === undefined) {
            const status = segment > 1 ? 'partial' : 'complete';
            // file_path is required NOT NULL; reconstruct the on-disk basename
            // with the real codec extension (defaults to mp3 — FEAT-002 §5.5).
            const filePath = `${folder}/${folder}-${stamp}.${ext}`;
            db.prepare(
                `INSERT INTO recordings
                   (stream_folder, date, hour, file_path, status, duration_seconds, size_bytes, segment_count)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(folder, date, hour, filePath, status, duration, size, segment);
            return true;
        }

        if (segment > 1) {
            db.prepare(
                `UPDATE recordings
                   SET duration_seconds = ?, size_bytes = ?, status = 'partial',
                       segment_count = MAX(segment_count, ?), updated_at = datetime('now')
                 WHERE stream_folder = ? AND date = ? AND hour = ?`
            ).run(duration, size, segment, folder, date, hour);
        } else {
            db.prepare(
                `UPDATE recordings
                   SET duration_seconds = ?, size_bytes = ?, updated_at = datetime('now')
                 WHERE stream_folder = ? AND date = ? AND hour = ?`
            ).run(duration, size, folder, date, hour);
        }
        return true;
    });
}

/**
 * DELETE the (stream_folder,date,hour) row when the cleaner unlinks its file.
 * Returns the number of rows removed (0 or 1). A `.partN` file maps to the same
 * hour row, so the first deleted segment removes the row for the hour.
 */
function deleteRecordingByFile(db, { folder, stamp }) {
    const split = splitStamp(stamp);
    if (split === null) {
        return 0;
    }
    const { date, hour } = split;
    const result = withBusyRetry(() =>
        db
            .prepare(
                'DELETE FROM recordings WHERE stream_folder = ? AND date = ? AND hour = ?'
            )
            .run(folder, date, hour)
    );
    return result.changes;
}

/**
 * INSERT-or-UPDATE a reconcile slot keyed on (stream_folder, date, hour) — the
 * worker-side mirror of src/api/services/recordings.js::upsertRecording, used by
 * the reconcile job (FEAT-002) to apply plan.inserts. The slot already carries
 * the derived file_path/status/segment_count from the planner, so this writes
 * them verbatim; duration_seconds/size_bytes are left for the peakfilegenerator
 * to fill. Wrapped in withBusyRetry. Returns the run result (`changes`).
 */
function upsertRecordingRow(db, { stream_folder, date, hour, file_path, status, segment_count }) {
    return withBusyRetry(() =>
        db
            .prepare(
                `INSERT INTO recordings
                   (stream_folder, date, hour, file_path, status, segment_count)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (stream_folder, date, hour) DO UPDATE SET
                   file_path     = excluded.file_path,
                   status        = excluded.status,
                   segment_count = excluded.segment_count,
                   updated_at    = datetime('now')`
            )
            .run(stream_folder, date, hour, file_path, status, segment_count ?? 1)
    );
}

/**
 * UPDATE the status/segment_count/file_path of an existing (stream_folder,date,
 * hour) row to the planner's derived values (reconcile plan.updates). Leaves
 * duration_seconds/size_bytes untouched. Wrapped in withBusyRetry. Returns the
 * number of rows changed (0 when the row no longer exists).
 */
function updateRecordingRow(db, { stream_folder, date, hour, status, segment_count, file_path }) {
    const result = withBusyRetry(() =>
        db
            .prepare(
                `UPDATE recordings
                   SET status = ?, segment_count = ?, file_path = ?,
                       updated_at = datetime('now')
                 WHERE stream_folder = ? AND date = ? AND hour = ?`
            )
            .run(status, segment_count ?? 1, file_path, stream_folder, date, hour)
    );
    return result.changes;
}

/**
 * DELETE the row for a (stream_folder,date,hour) slot (reconcile plan.removes,
 * the full-sync removal of a DB row whose file is gone from disk). Wrapped in
 * withBusyRetry. Returns the number of rows removed (0 or 1).
 */
function deleteRecordingBySlot(db, { stream_folder, date, hour }) {
    const result = withBusyRetry(() =>
        db
            .prepare(
                'DELETE FROM recordings WHERE stream_folder = ? AND date = ? AND hour = ?'
            )
            .run(stream_folder, date, hour)
    );
    return result.changes;
}

module.exports = {
    upsertRecordingMeta,
    deleteRecordingByFile,
    splitStamp,
    upsertRecordingRow,
    updateRecordingRow,
    deleteRecordingBySlot,
};
