/**
 * Pure stream-health derivation — TODO item 21 (admin "what's not working" panel).
 *
 * This module classifies each stream's recent recording coverage into
 * ok | degraded | down | never, derived PURELY from the existing recordings
 * rows + the existing expectedHourSlots/missingSlots helpers. No schema change,
 * no recorder-persisted health state: everything here reads the rows the
 * recorder already writes.
 *
 * `deriveStreamHealth` is PURE — no DB, no fs, no Date.now(). The caller
 * (routes/analysis.js) is the single place that reads the server clock and
 * formats the local-time `currentSlot`; the helper walks back `windowHours`
 * slots from that injected slot, so node:test covers it deterministically and
 * timezone-independently.
 *
 * This module is intentionally dependency-free (it does not `require` the
 * recordings service, which opens the DB handle at load time) so the pure
 * helper can be required and tested without any DB. The window slot walk below
 * mirrors recordings.js::expectedHourSlots exactly (UTC-walked, DST-safe).
 *
 * Boundaries (per stream, over the last `windowHours` slots ending at
 * `currentSlot` inclusive):
 *   - never    — the stream has NO complete recording ever and no rows at all
 *                in the injected set (brand-new stream that never recorded).
 *                "ever" is decided from the injected `lastCompleteByFolder`
 *                all-time signal when provided, NOT from the in-window rows —
 *                this is what keeps a long-stopped stream (which contributes
 *                zero in-window rows) classified `down`, not `never`.
 *   - down     — not never, and NO complete/live-recording slot anywhere in the
 *                recent window (was recording before, nothing good recently).
 *   - degraded — at least one healthy-present slot in the window AND at least
 *                one failure slot (intermittent gaps/partials).
 *   - ok       — every PAST expected slot in the window is healthy-present.
 * Precedence: never > down > degraded > ok.
 *
 * Current-hour grace: the current (in-progress) slot is EXPECTED but legitimately
 * not yet `complete` (status `recording`). It counts toward
 * expectedInWindow/presentInWindow but is NEVER counted as a failure for the
 * down decision or the consecutive-missing streak — only slots STRICTLY BEFORE
 * the current hour can be failures.
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
 * Per-stream health array derived from recent rows.
 *
 * @param {object} args
 * @param {Array<{folder:string, name?:string}>} args.streams
 *   The streams to classify (order preserved in the output). `folder` is the
 *   on-disk key; `name` is passed through for display.
 * @param {Array<{stream_folder:string, date:string, hour:string, status:string}>} args.rows
 *   Recent recordings rows across all folders (the route fetches these once).
 * @param {{date:string, hour:string}} args.currentSlot
 *   The current (in-progress) local hour-slot, injected by the caller.
 * @param {number} [args.windowHours=24]  Window length in hours.
 * @param {Object<string,string>|Map<string,string>} [args.lastCompleteByFolder]
 *   ALL-TIME latest complete slot key ('YYYY-MM-DD-HH') per folder, independent
 *   of the window. Supplied by the route from a `MAX(date||'-'||hour)` lookup
 *   over every complete row so that `never` means "no complete row EVER" and a
 *   stream that stopped before the window still classifies `down` (not `never`).
 *   When omitted the helper falls back to the latest complete it sees in `rows`,
 *   which only covers the window — so the route MUST pass this for correctness.
 * @returns {Array<{folder, name, status, lastSuccessfulSlot, consecutiveMissing, expectedInWindow, presentInWindow}>}
 */
function deriveStreamHealth({
    streams,
    rows,
    currentSlot,
    windowHours = 24,
    lastCompleteByFolder,
}) {
    const slots = windowSlots(currentSlot, windowHours);
    const currentKey = slotKey(currentSlot);

    // Normalize the injected all-time last-complete signal into a lookup that
    // accepts either a Map or a plain object keyed by folder.
    const allTimeLastComplete = (folder) => {
        if (!lastCompleteByFolder) {
            return undefined;
        }
        if (lastCompleteByFolder instanceof Map) {
            return lastCompleteByFolder.get(folder);
        }
        return lastCompleteByFolder[folder];
    };

    // Group rows by folder → Map(slotKey -> status) + track the latest complete.
    const byFolder = new Map();
    for (const row of rows || []) {
        let entry = byFolder.get(row.stream_folder);
        if (!entry) {
            entry = { statusBySlot: new Map(), lastComplete: null };
            byFolder.set(row.stream_folder, entry);
        }
        const key = `${row.date}-${row.hour}`;
        entry.statusBySlot.set(key, row.status);
        if (row.status === 'complete') {
            if (entry.lastComplete === null || key > entry.lastComplete) {
                entry.lastComplete = key;
            }
        }
    }

    return (streams || []).map((stream) => {
        const folder = stream.folder;
        const entry = byFolder.get(folder);
        const statusBySlot = entry ? entry.statusBySlot : new Map();
        const inWindowLastComplete = entry ? entry.lastComplete : null;

        // Prefer the all-time signal when supplied; otherwise fall back to the
        // latest complete seen in the (window-scoped) rows. Keep the later of
        // the two so an in-window complete newer than the stale signal still
        // wins (defensive; they should agree in practice).
        const allTime = allTimeLastComplete(folder);
        let lastCompleteKey = allTime ?? null;
        if (
            inWindowLastComplete !== null &&
            (lastCompleteKey === null || inWindowLastComplete > lastCompleteKey)
        ) {
            lastCompleteKey = inWindowLastComplete;
        }

        // A slot is healthy-present when a row exists and it is complete or (for
        // the live current hour) recording. Everything else — partial/missing
        // status or no row at all — is a failure, but only PAST slots count.
        const isHealthyPresent = (key) => {
            const st = statusBySlot.get(key);
            return st === 'complete' || st === 'recording';
        };

        let expectedInWindow = 0;
        let presentInWindow = 0;
        let healthyPastCount = 0;
        let failurePastCount = 0;

        for (const slot of slots) {
            const key = slotKey(slot);
            expectedInWindow += 1;
            const present = isHealthyPresent(key);
            if (present) {
                presentInWindow += 1;
            }
            // The current in-progress slot is graced: never a failure.
            if (key < currentKey) {
                if (present) {
                    healthyPastCount += 1;
                } else {
                    failurePastCount += 1;
                }
            }
        }

        // consecutiveMissing: trailing run of failure slots ending at the most
        // recent PAST slot (walk backward, stop at the first healthy-present).
        let consecutiveMissing = 0;
        for (let i = slots.length - 1; i >= 0; i -= 1) {
            const key = slotKey(slots[i]);
            if (key >= currentKey) {
                continue; // skip the graced current (and any future) slot
            }
            if (isHealthyPresent(key)) {
                break;
            }
            consecutiveMissing += 1;
        }

        const lastSuccessfulSlot =
            lastCompleteKey === null
                ? null
                : {
                      date: lastCompleteKey.slice(0, 10),
                      hour: lastCompleteKey.slice(11),
                  };

        // Classify (precedence never > down > degraded > ok).
        //
        // `never` requires BOTH no complete recording EVER (lastCompleteKey is
        // null — decided from the all-time signal, not just the window) AND no
        // rows at all in the injected set. A stream that recorded before and
        // then stopped has a non-null all-time lastCompleteKey, so it skips
        // `never` and lands in `down` below — this is the stopped-vs-brand-new
        // distinction the feature requires.
        let status;
        const hasAnyRow = statusBySlot.size > 0;
        if (!hasAnyRow && lastCompleteKey === null) {
            status = 'never';
        } else if (healthyPastCount === 0 && failurePastCount > 0) {
            status = 'down';
        } else if (failurePastCount > 0) {
            status = 'degraded';
        } else {
            status = 'ok';
        }

        return {
            folder,
            name: stream.name ?? folder,
            status,
            lastSuccessfulSlot,
            consecutiveMissing,
            expectedInWindow,
            presentInWindow,
        };
    });
}

/**
 * Roll-up counts for the endpoint headline.
 * @param {Array<{status:string}>} healthArray
 * @returns {{total, unhealthy, ok, degraded, down, never}}
 */
function summarizeHealth(healthArray) {
    const counts = {
        total: 0,
        unhealthy: 0,
        ok: 0,
        degraded: 0,
        down: 0,
        never: 0,
    };
    for (const h of healthArray || []) {
        counts.total += 1;
        if (h.status in counts) {
            counts[h.status] += 1;
        }
        if (h.status !== 'ok') {
            counts.unhealthy += 1;
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
