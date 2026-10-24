/**
 * /api/analysis routes: read-only recording analytics (storage/duration summary
 * + hourly gap analysis) — FEAT-001. EVERYTHING in this router is behind
 * requireAuth; there is no public analysis surface. Validation failures return
 * 400 {error, field}; DB errors are caught, logged, and returned as
 * 500 {error: 'Internal Server Error: …'}, mirroring routes/jobs.js and
 * routes/api.js so the frontend's ApiError plumbing surfaces them unchanged.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const {
    summarize,
    listByStreamAndRange,
    listRecentByDate,
    expectedHourSlots,
    missingSlots,
} = require('../services/recordings');
const { listStreams } = require('../services/streams');
const {
    deriveStreamHealth,
    summarizeHealth,
} = require('../services/stream-health');
const { amsterdamSlot } = require('../lib/amsterdam-slot');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Window bounds for the stream-health endpoint: 1 hour .. 7 days (168h), the
// same ceiling the retention config uses. Default 24h.
const DEFAULT_WINDOW_HOURS = 24;
const MIN_WINDOW_HOURS = 1;
const MAX_WINDOW_HOURS = 168;

// GET /api/analysis/summary (requireAuth) — per-stream + overall roll-up of
// recording storage/duration/coverage. Shape: { per_stream: [...], overall: {...} }.
router.get('/summary', requireAuth, (req, res) => {
    try {
        const { per_stream, overall } = summarize();
        return res.json({ per_stream, overall });
    } catch (err) {
        console.error('Error building analysis summary:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/analysis/gaps?folder=&start=&end= (requireAuth) — hourly coverage for
// one folder over an inclusive date range. Shape:
//   { folder, start, end, expected_count, present_count,
//     missing: [{date, hour}], coverage_ratio }
// folder is required; start/end must be YYYY-MM-DD with start <= end.
router.get('/gaps', requireAuth, (req, res) => {
    const folder = req.query.folder;
    const start = req.query.start;
    const end = req.query.end;

    if (typeof folder !== 'string' || folder.trim() === '') {
        return res.status(400).json({ error: 'folder is required', field: 'folder' });
    }
    if (typeof start !== 'string' || !DATE_RE.test(start)) {
        return res
            .status(400)
            .json({ error: 'start must be YYYY-MM-DD', field: 'start' });
    }
    if (typeof end !== 'string' || !DATE_RE.test(end)) {
        return res
            .status(400)
            .json({ error: 'end must be YYYY-MM-DD', field: 'end' });
    }
    if (start > end) {
        return res
            .status(400)
            .json({ error: 'start must be <= end', field: 'start' });
    }

    try {
        const present = listByStreamAndRange(folder, start, end);
        const expected = expectedHourSlots(start, end);
        const missing = missingSlots(expected, present);
        const expectedCount = expected.length;
        const presentCount = expectedCount - missing.length;
        return res.json({
            folder,
            start,
            end,
            expected_count: expectedCount,
            present_count: presentCount,
            missing,
            coverage_ratio: expectedCount === 0 ? 0 : presentCount / expectedCount,
        });
    } catch (err) {
        console.error('Error building analysis gaps:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/analysis/stream-health?windowHours=N (requireAuth) — per-stream
// TWO-SIGNAL health: "Now" (is the stream recording the CURRENT Amsterdam-local
// hour-slot) + "Last 24h" (an informational gap summary over the window's past
// slots). The current slot + window are computed in EUROPE/AMSTERDAM time via
// amsterdamSlot (DST-correct), matching the recorder's local-time hour stamps.
// Shape:
//   { window_hours, generated_slot:{date,hour},
//     counts:{total,recordingNow,notRecording},
//     streams:[{folder,name,recordingNow,
//               last24h:{complete,gapCount,gaps:[{date,hour}]},lastSlotStatus}] }
// windowHours is optional (default 24), an integer in [1,168]; invalid → 400.
router.get('/stream-health', requireAuth, (req, res) => {
    let windowHours = DEFAULT_WINDOW_HOURS;
    if (req.query.windowHours !== undefined) {
        const raw = req.query.windowHours;
        const n = Number(raw);
        if (
            !/^\d+$/.test(String(raw)) ||
            !Number.isInteger(n) ||
            n < MIN_WINDOW_HOURS ||
            n > MAX_WINDOW_HOURS
        ) {
            return res.status(400).json({
                error: `windowHours must be an integer in [${MIN_WINDOW_HOURS}, ${MAX_WINDOW_HOURS}]`,
                field: 'windowHours',
            });
        }
        windowHours = n;
    }

    try {
        const now = new Date();
        // Current slot + window start computed in Europe/Amsterdam (DST-correct
        // via Intl), matching the recorder's local-time hour stamps — NOT UTC
        // and NOT the ambient process TZ.
        const currentSlot = amsterdamSlot(now);
        // The window's earliest calendar date: windowHours-1 hours back. The
        // same amsterdamSlot runs on the start instant, so a DST transition
        // inside the window can never narrow the fetched date range (the helper
        // slices to the exact window, so extra rows are harmless).
        const startMs = now.getTime() - windowHours * 3600 * 1000;
        const startDate = amsterdamSlot(new Date(startMs)).date;

        const rows = listRecentByDate(startDate, currentSlot.date);
        const streams = listStreams();
        const health = deriveStreamHealth({
            streams,
            rows,
            currentSlot,
            windowHours,
        });
        const counts = summarizeHealth(health);

        return res.json({
            window_hours: windowHours,
            generated_slot: currentSlot,
            counts,
            streams: health,
        });
    } catch (err) {
        console.error('Error building stream health:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

module.exports = router;
