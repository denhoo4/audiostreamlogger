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
    ConfigValidationError,
} = require('../services/app-config');
const { getJob } = require('../services/jobs');
const {
    listStreams,
    getStream,
    createStream,
    updateStream,
    deleteStream,
    DuplicateFolderError,
} = require('../services/streams');

// GET /api/settings (PUBLIC) — player selector; shaped like the old
// settings.json.streams array (no id/timestamps).
router.get('/settings', (req, res) => {
    try {
        const streams = listStreams().map(({ country, name, folder, url }) => ({
            country,
            name,
            folder,
            url,
        }));
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
// without a session (page title).
router.get('/app-config/public', (req, res) => {
    try {
        const title = getConfig('app_title') ?? DEFAULT_APP_TITLE;
        res.json({ title });
    } catch (err) {
        console.error('Error reading public app-config:', err);
        res.status(500).json({ error: `Internal Server Error: ${err.message}` });
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

    try {
        const updated = updateStream(id, {
            country: body.country,
            name: body.name,
            folder: body.folder,
            url: body.url,
        });
        if (!updated) {
            return res.status(404).json({ error: 'stream not found' });
        }
        return res.json(updated);
    } catch (err) {
        if (err instanceof DuplicateFolderError) {
            return res.status(409).json({ error: 'folder already in use' });
        }
        console.error('Error updating stream:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

// DELETE /api/streams/:id (requireAuth) — remove a stream.
router.delete('/streams/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'invalid id', field: 'id' });
    }

    try {
        const removed = deleteStream(id);
        if (!removed) {
            return res.status(404).json({ error: 'stream not found' });
        }
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error deleting stream:', err);
        return res.status(500).json({ error: `Internal Server Error: ${err.message}` });
    }
});

module.exports = router;
