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
    expectedHourSlots,
    missingSlots,
} = require('../services/recordings');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

module.exports = router;
