/**
 * Pure stream-health derivation — TODO item 21 (admin "what's working" panel, v2).
 *
 * The panel is split into TWO INDEPENDENT signals per stream:
 *   1. "Now" (green check) — is this stream recording RIGHT NOW. Decided ONLY
 *      from the row for the CURRENT (in-progress) hour-slot. A current-slot row
 *      with status `recording` (defensively also `complete`/`partial`, i.e. the
 *      hour just finalized) → recordingNow = true; no current-slot row → false.
 *      NO 24h gap count may affect this signal. The in-progress current hour is
 *      NEVER a "missing" failure.
 *   2. "Last 24h" — a short, purely informational gap summary over the window's
 *      PAST slots (strictly before the current slot). It does NOT affect the
 *      green check. `complete` when there are no gaps, else the list of missing
 *      Amsterdam-local {date, hour} slots. The in-progress current hour is
 *      EXCLUDED from the gap list (it is not a gap yet).
 *
 * `deriveStreamHealth` is PURE — no DB, no fs, no Date.now(). The caller
 * (routes/analysis.js) is the single place that reads the server clock and
 * formats the Amsterdam-local `currentSlot`; the helper walks back `windowHours`
 * slots from that injected slot, so node:test covers it deterministically and
 * timezone-independently.
 *
 * This module is intentionally dependency-free (it does not `require` the
 * recordings service, which opens the DB handle at load time) so the pure
 * helper can be required and tested without any DB. The window slot walk below
 * mirrors recordings.js::expectedHourSlots exactly (UTC-walked, DST-safe).
 *
 * Gap definition (encoded in the helper tests): a past window slot is a GAP when
 * it has NO `complete` row — no row at all, or only a `partial` row. `complete`
 * = filled; everything else (partial, missing) = gap, matching the user's ask
 * for "gaps qua opname-tijden".
 */
/** 'YYYY-MM-DD-HH' key for a {date, hour} slot (stable string compare order). */
function slotKey(slot) {
    return `${slot.date}-${slot.hour}`;
}

/** Pad an hour integer 0..23 to the two-char 'HH' string used on disk/in rows. */
function padHour(h) {
    return String(h).padStart(2, '0');
}

/**
 * Every hourly slot in the inclusive date range [startDate, endDate] as an
 * array of { date, hour } ordered chronologically. Mirrors
 * recordings.js::expectedHourSlots (walked in UTC so no DST/offset drift); kept
 * local to avoid importing the DB-backed recordings module into this pure file.
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
 * The last `windowHours` hour-slots ending at `currentSlot` inclusive, as an
 * array of { date ('YYYY-MM-DD'), hour ('HH') } ordered chronologically. The
 * start date is `windowHours-1` hours before `currentSlot`; we expand the full
 * day span via expectedHourSlots then slice to exactly the trailing window so
 * the slot math reuses the existing (UTC-walked, DST-safe) helper.
 */
function windowSlots(currentSlot, windowHours) {
    const hours = Math.max(1, Math.trunc(windowHours));
    // Anchor at the current slot's UTC instant and step back (hours-1) hours.
    const endMs = Date.parse(`${currentSlot.date}T${currentSlot.hour}:00:00Z`);
    const startMs = endMs - (hours - 1) * 3600 * 1000;
    const startDate = new Date(startMs).toISOString().slice(0, 10);
    const endDate = currentSlot.date;

    const all = expectedHourSlots(startDate, endDate);
    const endKey = slotKey(currentSlot);
    // Keep only slots up to and including the current slot, then the trailing
    // `hours` of them.
    const upToCurrent = all.filter((s) => slotKey(s) <= endKey);
    return upToCurrent.slice(-hours);
}

/**
 * Per-stream two-signal health array derived from recent rows.
 *
 * @param {object} args
 * @param {Array<{folder:string, name?:string}>} args.streams
 *   The streams to classify (order preserved in the output). `folder` is the
 *   on-disk key; `name` is passed through for display.
 * @param {Array<{stream_folder:string, date:string, hour:string, status:string}>} args.rows
 *   Recent recordings rows across all folders (the route fetches these once).
 * @param {{date:string, hour:string}} args.currentSlot
 *   The current (in-progress) Amsterdam-local hour-slot, injected by the caller.
 * @param {number} [args.windowHours=24]  Window length in hours.
 * @returns {Array<{folder, name, recordingNow, last24h:{complete, gapCount, gaps:[{date,hour}]}, lastSlotStatus}>}
 *   - recordingNow: decided ONLY from the current slot's row status.
 *   - last24h: gap summary over the PAST slots in the window (current slot
 *     excluded). `complete` is true when `gapCount === 0`; `gaps` lists the
 *     missing {date, hour} slots in chronological order.
 *   - lastSlotStatus: the current slot's row status (or null) — a small hint
 *     of the stream's current state.
 */
function deriveStreamHealth({ streams, rows, currentSlot, windowHours = 24 }) {
    const slots = windowSlots(currentSlot, windowHours);
    const currentKey = slotKey(currentSlot);

    // Group rows by folder → Map(slotKey -> status).
    const byFolder = new Map();
    for (const row of rows || []) {
        let statusBySlot = byFolder.get(row.stream_folder);
        if (!statusBySlot) {
            statusBySlot = new Map();
            byFolder.set(row.stream_folder, statusBySlot);
        }
        statusBySlot.set(`${row.date}-${row.hour}`, row.status);
    }

    return (streams || []).map((stream) => {
        const folder = stream.folder;
        const statusBySlot = byFolder.get(folder) || new Map();

        // "Now" signal: decided ONLY from the current slot's row status. A row
        // with status `recording` (or defensively `complete`/`partial` for the
        // hour that just finalized) means the stream is recording this hour.
        const currentStatus = statusBySlot.get(currentKey) ?? null;
        const recordingNow =
            currentStatus === 'recording' ||
            currentStatus === 'complete' ||
            currentStatus === 'partial';

        // "Last 24h" signal: list the PAST window slots (strictly before the
        // current slot) that have no `complete` row. The in-progress current
        // slot is excluded — it is never a gap.
        const gaps = [];
        for (const slot of slots) {
            const key = slotKey(slot);
            if (key >= currentKey) {
                continue; // skip the in-progress current (and any future) slot
            }
            if (statusBySlot.get(key) !== 'complete') {
                gaps.push({ date: slot.date, hour: slot.hour });
            }
        }

        return {
            folder,
            name: stream.name ?? folder,
            recordingNow,
            last24h: {
                complete: gaps.length === 0,
                gapCount: gaps.length,
                gaps,
            },
            lastSlotStatus: currentStatus,
        };
    });
}

/**
 * Roll-up counts for the endpoint headline.
 * @param {Array<{recordingNow:boolean}>} healthArray
 * @returns {{total, recordingNow, notRecording}}
 */
function summarizeHealth(healthArray) {
    const counts = { total: 0, recordingNow: 0, notRecording: 0 };
    for (const h of healthArray || []) {
        counts.total += 1;
        if (h.recordingNow) {
            counts.recordingNow += 1;
        } else {
            counts.notRecording += 1;
        }
    }
    return counts;
}

module.exports = {
    slotKey,
    windowSlots,
    deriveStreamHealth,
    summarizeHealth,
};
