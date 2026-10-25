/**
 * /api routes: public stream projections + authenticated stream CRUD.
 *
 * Streams are sourced from the SQLite DB (FEAT-001/FEAT-002), replacing the old
 * settings.json reads. Two read shapes:
 *   - GET /settings  (PUBLIC)  -> {country,name,folder,url} only (player selector).
 *   - GET /streams   (requireAuth) -> full rows with id + timestamps (admin).
 * Writes (POST/PUT/DELETE /streams) are all behind requireAuth.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { validateStream } = require('../lib/validate-stream');
const {
    probeStreamUrl,
    ProbeInputError,
} = require('../lib/probe-stream-url');
const { buildSettings2 } = require('../services/browse');
const {
    getConfig,
    setConfig,
    parseCountryOrder,
    ConfigValidationError,
} = require('../services/app-config');
const { getJob } = require('../services/jobs');
const {
    listStreams,
    getStream,
    getStreamByFolder,
    createStream,
    updateStream,
    reorderStreams,
    DuplicateFolderError,
    ReorderMismatchError,
} = require('../services/streams');
const {
    deletionImpact,
    deleteStreamWithFolder,
    renameStreamFolder,
    RenameValidationError,
    StreamRecordingNowError,
    UnsafeFolderError,
} = require('../services/stream-lifecycle');

// GET /api/settings (PUBLIC) — player selector; shaped like the old
// settings.json.streams array (no id/timestamps).
router.get('/settings', (req, res) => {
    try {
        const streams = listStreams().map(
            ({ country, name, folder, url, codec }) => ({
                country,
                name,
                folder,
                url,
                codec,
            })
        );
        res.json(streams);
    } catch (err) {
        console.error('Error reading streams:', err);
        res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/settings2 (PUBLIC) — nested browse tree from DB streams + folder scan.
router.get('/settings2', async (req, res) => {
    try {
        const transformedData = await buildSettings2();
        res.json(transformedData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: `Internal Server Error: ${error.message}` });
    }
});

const DEFAULT_APP_TITLE = 'Dé radiologger';

// GET /api/app-config/public (PUBLIC) — runtime branding the player reads
// without a session (page title + preselected default stream folder).
router.get('/app-config/public', (req, res) => {
    try {
        const title = getConfig('app_title') ?? DEFAULT_APP_TITLE;
        const default_stream_folder = getConfig('default_stream_folder') ?? '';
        const country_order = parseCountryOrder(getConfig('country_order'));
        res.json({ title, default_stream_folder, country_order });
    } catch (err) {
        console.error('Error reading public app-config:', err);
        res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// PUT /api/app-config/default-stream (requireAuth) — set/clear the player's
// preselected default stream folder. A non-empty folder must match a known
// stream; the empty string clears the default.
router.put('/app-config/default-stream', requireAuth, (req, res) => {
    const body = req.body || {};
    const folder = body.folder;

    if (typeof folder !== 'string') {
        return res
            .status(400)
            .json({ error: 'default_stream_folder must be a string', field: 'folder' });
    }

    if (folder !== '' && !getStreamByFolder(folder)) {
        return res.status(400).json({ error: 'unknown folder', field: 'folder' });
    }

    try {
        const default_stream_folder = setConfig('default_stream_folder', folder);
        return res.json({ default_stream_folder });
    } catch (err) {
        if (err instanceof ConfigValidationError) {
            return res.status(400).json({ error: err.error, field: 'folder' });
        }
        console.error('Error updating default_stream_folder:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// PUT /api/app-config/country-order (requireAuth) — set the explicit admin
// ordering of countries. Body `{ codes }` must be an array of two-letter ISO
// alpha-2 code strings; the codes are uppercased and stored as a JSON array.
router.put('/app-config/country-order', requireAuth, (req, res) => {
    const codes = (req.body || {}).codes;

    const valid =
        Array.isArray(codes) && codes.every((c) => typeof c === 'string');
    if (!valid) {
        return res
            .status(400)
            .json({ error: 'codes must be an array of strings', field: 'country_order' });
    }

    try {
        setConfig(
            'country_order',
            JSON.stringify(codes.map((c) => c.toUpperCase()))
        );
        return res.json({ country_order: parseCountryOrder(getConfig('country_order')) });
    } catch (err) {
        if (err instanceof ConfigValidationError) {
            return res.status(400).json({ error: err.error, field: 'country_order' });
        }
        console.error('Error updating country_order:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// PUT /api/app-config/title (requireAuth) — update the editable page title.
router.put('/app-config/title', requireAuth, (req, res) => {
    const body = req.body || {};
    try {
        const title = setConfig('app_title', body.title);
        return res.json({ title });
    } catch (err) {
        if (err instanceof ConfigValidationError) {
            return res.status(400).json({ error: err.error, field: 'title' });
        }
        console.error('Error updating app_title:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/worker/status (requireAuth) — worker liveness for the admin screen.
// Reads the informational app_config rows the worker UPSERTs on its 5s timer and
// resolves the current job (if any) from the jobs table. Never 500s on a missing
// key: absent values are returned as null.
router.get('/worker/status', requireAuth, (req, res) => {
    try {
        const last_heartbeat = getConfig('worker_last_heartbeat') ?? null;
        const status = getConfig('worker_status') ?? null;
        const currentJobId = getConfig('worker_current_job_id');

        let current_job = null;
        if (currentJobId !== undefined && currentJobId !== '') {
            const id = Number(currentJobId);
            if (Number.isInteger(id) && id > 0) {
                current_job = getJob(id) ?? null;
            }
        }

        return res.json({ last_heartbeat, status, current_job });
    } catch (err) {
        console.error('Error reading worker status:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/streams (requireAuth) — admin list with id + timestamps.
router.get('/streams', requireAuth, (req, res) => {
    try {
        res.json(listStreams());
    } catch (err) {
        console.error('Error listing streams:', err);
        res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/streams/:id/deletion-impact (requireAuth) — ADVISORY snapshot of
// what a DELETE would destroy: the file count + total bytes under
// audio/<folder>/ for the stream. Advisory ONLY — the real gate is the
// typed-folder confirmation in the admin UI. 404 on an unknown id.
router.get('/streams/:id/deletion-impact', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'invalid id', field: 'id' });
    }

    const stream = getStream(id);
    if (!stream) {
        return res.status(404).json({ error: 'stream not found' });
    }

    try {
        const impact = deletionImpact(stream.folder);
        return res.json(impact);
    } catch (err) {
        console.error('Error computing deletion impact:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// POST /api/streams (requireAuth) — create a stream.
router.post('/streams', requireAuth, (req, res) => {
    const body = req.body || {};
    const invalid = validateStream(body);
    if (invalid) {
        return res.status(400).json(invalid);
    }

    try {
        const created = createStream({
            country: body.country,
            name: body.name,
            folder: body.folder,
            url: body.url,
            codec: body.codec,
            bitrate_kbps: body.bitrate_kbps,
            bit_depth: body.bit_depth,
        });
        return res.status(201).json(created);
    } catch (err) {
        if (err instanceof DuplicateFolderError) {
            return res.status(409).json({ error: 'folder already in use' });
        }
        console.error('Error creating stream:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// POST /api/streams/test-url (requireAuth) — advisory reachability probe.
//
// NON-BLOCKING "Test" helper: it does NOT persist anything and is NOT a gate on
// create/update (the format validator stays the only save-path gate). It runs
// the SAME validateUrl rule first (http(s) only, well-formed) and 400s on bad
// input, then probes whether the URL answers like a reachable audio stream,
// bounded by a hard timeout. It never 500s on a probe failure — a DNS/timeout/
// non-2xx/non-audio outcome is reported as {reachable:false, detail}. SSRF
// reasoning is documented in lib/probe-stream-url.js (admin-only, http(s)-only,
// bounded timeout, headers-only read, no shell interpolation of the URL).
router.post('/streams/test-url', requireAuth, async (req, res) => {
    const body = req.body || {};
    try {
        const result = await probeStreamUrl(body.url);
        return res.json(result);
    } catch (err) {
        if (err instanceof ProbeInputError) {
            return res.status(400).json({ error: err.message, field: 'url' });
        }
        // Defensive: the probe is designed never to throw for network failures,
        // but if something unexpected happens we still return the advisory
        // shape rather than leaking a 500 for a non-critical helper.
        console.error('Error probing stream url:', err);
        return res.json({ reachable: false, detail: 'probe failed' });
    }
});

// PUT /api/streams/reorder (requireAuth) — persist a new stream order.
//
// Registered BEFORE PUT /streams/:id so the literal `reorder` path is not
// captured as an :id. Body `{ order }` must be an array of positive integers
// listing every stream id exactly once; a mismatch returns 400.
router.put('/streams/reorder', requireAuth, (req, res) => {
    const body = req.body || {};
    const { order } = body;

    const valid =
        Array.isArray(order) &&
        order.every((id) => Number.isInteger(id) && id > 0);
    if (!valid) {
        return res.status(400).json({ error: 'invalid order', field: 'order' });
    }

    try {
        reorderStreams(order);
        return res.json({ ok: true });
    } catch (err) {
        if (err instanceof ReorderMismatchError) {
            return res.status(400).json({
                error: 'order must list every stream exactly once',
                field: 'order',
            });
        }
        console.error('Error reordering streams:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// PUT /api/streams/:id (requireAuth) — update a stream.
router.put('/streams/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'invalid id', field: 'id' });
    }

    const body = req.body || {};
    const invalid = validateStream(body);
    if (invalid) {
        return res.status(400).json(invalid);
    }

    // ITEM 26 — when the update CHANGES `folder`, the on-disk audio/<folder>/
    // dir must move and every recordings row must re-point BEFORE the streams
    // row flips to the new folder. renameStreamFolder does the move + row
    // rebuild (stamp-anchored) and enforces the allowlist/not-exists/differs
    // validation + the current-slot live-recorder 409 guard. We run it first so
    // a refusal (409/400) leaves both disk and the streams row untouched.
    const existing = getStream(id);
    if (!existing) {
        return res.status(404).json({ error: 'stream not found' });
    }
    const folderChanged =
        typeof body.folder === 'string' && body.folder !== existing.folder;

    try {
        if (folderChanged) {
            renameStreamFolder(existing.folder, body.folder);
        }

        const updated = updateStream(id, {
            country: body.country,
            name: body.name,
            folder: body.folder,
            url: body.url,
            codec: body.codec,
            bitrate_kbps: body.bitrate_kbps,
            bit_depth: body.bit_depth,
        });
        if (!updated) {
            return res.status(404).json({ error: 'stream not found' });
        }
        return res.json(updated);
    } catch (err) {
        if (err instanceof StreamRecordingNowError) {
            return res.status(409).json({ error: err.message });
        }
        if (err instanceof RenameValidationError) {
            return res.status(400).json({ error: err.message, field: err.field });
        }
        if (err instanceof UnsafeFolderError) {
            return res.status(400).json({ error: err.message, field: 'folder' });
        }
        if (err instanceof DuplicateFolderError) {
            return res.status(409).json({ error: 'folder already in use' });
        }
        console.error('Error updating stream:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// DELETE /api/streams/:id (requireAuth) — remove a stream, its recordings rows
// AND its on-disk audio/<folder>/ dir (ITEM 25, destructive + irreversible).
//
// deleteStreamWithFolder removes the rows (recordings + streams) TRANSACTIONALLY
// FIRST, then rm's the folder — the row-first ordering closes the window where
// the live recorder could resurrect the folder (see the service for the full
// rationale). It refuses with 409 when the stream is recording the current hour
// right now. An fs.rm failure AFTER the rows are gone is reported (fsError) but
// is not an error: the stream is already logically deleted.
router.delete('/streams/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'invalid id', field: 'id' });
    }

    try {
        const result = deleteStreamWithFolder(id);
        if (!result) {
            return res.status(404).json({ error: 'stream not found' });
        }
        return res.json({ ok: true, folder: result.folder, fsError: result.fsError });
    } catch (err) {
        if (err instanceof StreamRecordingNowError) {
            return res.status(409).json({ error: err.message });
        }
        if (err instanceof UnsafeFolderError) {
            return res.status(400).json({ error: err.message, field: 'folder' });
        }
        console.error('Error deleting stream:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

module.exports = router;
