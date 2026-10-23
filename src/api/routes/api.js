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
const { buildSettings2 } = require('../services/browse');
const {
    getConfig,
    setConfig,
    ConfigValidationError,
} = require('../services/app-config');
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
