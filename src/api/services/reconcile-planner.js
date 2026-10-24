/**
 * Shared pure two-way reconcile planner — FEAT-001.
 *
 * This is the SINGLE implementation of the on-disk <-> recordings-table
 * reconcile, reused by the api's startup backfill (runBackfill, insert-only) and
 * (FEAT-002) by the worker's reconcile job (which applies all three directions).
 * It is PURE: no fs, no DB. The caller scans the audio tree and loads the DB rows;
 * the planner only diffs the two sides and returns the work to do.
 *
 * reconcilePlan(existingRows, scannedFiles, options) -> { inserts, removes, updates }
 *
 *   existingRows  array of DB rows { stream_folder, date, hour, status,
 *                 segment_count, file_path } (the current recordings table).
 *   scannedFiles  array of parsed on-disk files { folder, date, hour, part,
 *                 file_path } (part 1 = primary, 2+ = a `.partN` segment).
 *   options       { currentStamp } where currentStamp is the local
 *                 'YYYY-MM-DD-HH' slot actively being recorded (may be null).
 *
 * Folding (identical to the original recordings-backfill reconcilePlan): scanned
 * files collapse into one slot per 'folder|date|hour'. segment_count = number of
 * distinct files folded; status is 'partial' if ANY `.partN` segment is present,
 * else 'complete'; file_path is the primary file when present, else the
 * lowest-part segment seen.
 *
 *   inserts  folded slots with NO matching existingRow, as
 *            { stream_folder, date, hour, file_path, status, segment_count }
 *            — identical to the original plan shape so upsertRecording keeps
 *            working unchanged. Idempotent: empty when every folded slot already
 *            exists with matching metadata.
 *   removes  existingRows with NO scanned slot, as { stream_folder, date, hour }.
 *   updates  slots present on BOTH sides whose derived status / segment_count /
 *            file_path differ from the existingRow, as { stream_folder, date,
 *            hour, status, segment_count, file_path }.
 *
 * Design decision 2 — remove-not-missing (full-sync): a DB row with no file on
 * disk is REMOVED, not just skipped. This makes reconcile a true full-sync of the
 * table against the disk and matches the cleaner handler, which already deletes a
 * recordings row when it unlinks the backing file.
 *
 * Design decision 3 — current-hour / 'recording' guard: the slot that is actively
 * being recorded is mid-write — its files and derived status are in flux — so it
 * is NEVER removed and NEVER restatused. A slot is guarded when its 'date-hour'
 * equals options.currentStamp OR when its existingRow.status === 'recording'.
 * Guarded slots are excluded from both `removes` and `updates` (a brand-new slot
 * for the current hour can still be inserted — there is no row to disturb yet).
 */

/** Fold parsed scanned files into one derived slot per 'folder|date|hour'. */
function foldScannedFiles(scannedFiles) {
    const slots = new Map();

    for (const file of scannedFiles || []) {
        const key = `${file.folder}|${file.date}|${file.hour}`;

        let slot = slots.get(key);
        if (!slot) {
            slot = {
                stream_folder: file.folder,
                date: file.date,
                hour: file.hour,
                file_path: file.file_path,
                _primaryPath: null,
                _minPart: file.part,
                segment_count: 0,
                _hasSegment: false,
            };
            slots.set(key, slot);
        }

        slot.segment_count += 1;
        if (file.part === 1) {
            slot._primaryPath = file.file_path;
        } else {
            slot._hasSegment = true;
        }
        if (file.part < slot._minPart) {
            slot._minPart = file.part;
            if (file.part !== 1) {
                slot.file_path = file.file_path;
            }
        }
    }

    const folded = new Map();
    for (const [key, slot] of slots) {
        folded.set(key, {
            stream_folder: slot.stream_folder,
            date: slot.date,
            hour: slot.hour,
            file_path: slot._primaryPath || slot.file_path,
            status: slot._hasSegment ? 'partial' : 'complete',
            segment_count: slot.segment_count,
        });
    }
    return folded;
}

/**
 * Two-way reconcile between the recordings table and the scanned audio tree.
 * Pure; see the file header for the full contract and the two design decisions.
 */
function reconcilePlan(existingRows, scannedFiles, options = {}) {
    const currentStamp = options.currentStamp ?? null;

    const existingByKey = new Map();
    for (const row of existingRows || []) {
        existingByKey.set(`${row.stream_folder}|${row.date}|${row.hour}`, row);
    }

    const foldedByKey = foldScannedFiles(scannedFiles);

    const inserts = [];
    const updates = [];
    const removes = [];

    // Walk the scanned side: a slot is an insert (no row) or possibly an update.
    for (const [key, slot] of foldedByKey) {
        const row = existingByKey.get(key);
        if (!row) {
            inserts.push({
                stream_folder: slot.stream_folder,
                date: slot.date,
                hour: slot.hour,
                file_path: slot.file_path,
                status: slot.status,
                segment_count: slot.segment_count,
            });
            continue;
        }

        // Present on both sides. Guard the actively-recording slot: never
        // restatus a mid-write hour (design decision 3).
        if (isGuardedSlot(slot, row, currentStamp)) {
            continue;
        }

        if (
            row.status !== slot.status ||
            row.segment_count !== slot.segment_count ||
            row.file_path !== slot.file_path
        ) {
            updates.push({
                stream_folder: slot.stream_folder,
                date: slot.date,
                hour: slot.hour,
                status: slot.status,
                segment_count: slot.segment_count,
                file_path: slot.file_path,
            });
        }
    }

    // Walk the DB side: a row with no scanned slot is a remove (full-sync),
    // unless it is the guarded current-hour / 'recording' slot.
    for (const [key, row] of existingByKey) {
        if (foldedByKey.has(key)) {
            continue;
        }
        if (isGuardedSlot(row, row, currentStamp)) {
            continue;
        }
        removes.push({
            stream_folder: row.stream_folder,
            date: row.date,
            hour: row.hour,
        });
    }

    return { inserts, removes, updates };
}

/**
 * A slot is guarded (never removed, never restatused) when it is the actively
 * recorded hour: its 'date-hour' equals currentStamp, or the DB row's status is
 * 'recording'. `slot` supplies date/hour; `row` supplies status (may be null for
 * a disk-only slot, which then only matches on currentStamp).
 */
function isGuardedSlot(slot, row, currentStamp) {
    if (row && row.status === 'recording') {
        return true;
    }
    if (currentStamp && `${slot.date}-${slot.hour}` === currentStamp) {
        return true;
    }
    return false;
}

module.exports = { reconcilePlan };
