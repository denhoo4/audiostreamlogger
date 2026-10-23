/**
 * /api/branding routes: favicon upload (authed) + public favicon serve.
 *
 * Upload uses a ROUTE-LOCAL express.raw() parser so the global express.json in
 * index.js never intercepts the binary body. The bytes are written to a file
 * under the ./data volume (/usr/src/app/data/branding/favicon.<ext>) with the
 * path + MIME recorded in app_config (favicon_path / favicon_mime); the serve
 * route streams that file, or a bundled default PNG when none is set.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { getConfig, setConfig } = require('../services/app-config');
const { validateFaviconUpload, MIME_EXT } = require('../lib/validate-favicon');

// The ./data bind mount is at /usr/src/app/data; the branding dir is a sibling
// of the SQLite DB file there. The bundled default ships inside the api image.
const BRANDING_DIR = path.join('/usr/src/app/data', 'branding');
const DEFAULT_FAVICON = path.join(__dirname, '..', 'assets', 'default-favicon.png');

// Route-local raw parser: only the four accepted favicon MIME types, 1 MiB cap.
const rawFavicon = express.raw({
    type: [
        'image/png',
        'image/x-icon',
        'image/vnd.microsoft.icon',
        'image/svg+xml',
    ],
    limit: '1mb',
});

// POST /api/branding/favicon (requireAuth) — upload a new favicon.
router.post('/favicon', requireAuth, rawFavicon, (req, res) => {
    const contentType = req.headers['content-type'];
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    const invalid = validateFaviconUpload({
        contentType,
        byteLength: body.length,
    });
    if (invalid) {
        return res.status(400).json(invalid);
    }

    const mime = contentType.split(';')[0].trim().toLowerCase();
    const ext = MIME_EXT[mime];

    try {
        fs.mkdirSync(BRANDING_DIR, { recursive: true });
        const target = path.join(BRANDING_DIR, `favicon.${ext}`);
        fs.writeFileSync(target, body);

        // Remove any prior favicon whose extension differs so stale files don't
        // linger on the volume.
        for (const otherExt of new Set(Object.values(MIME_EXT))) {
            if (otherExt === ext) continue;
            const stale = path.join(BRANDING_DIR, `favicon.${otherExt}`);
            if (fs.existsSync(stale)) {
                fs.rmSync(stale, { force: true });
            }
        }

        setConfig('favicon_path', target);
        setConfig('favicon_mime', mime);
        return res.json({ ok: true, mime });
    } catch (err) {
        console.error('Error storing favicon:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/branding/favicon (PUBLIC) — stream the stored icon or the default.
router.get('/favicon', (req, res) => {
    const faviconPath = getConfig('favicon_path');
    const faviconMime = getConfig('favicon_mime');

    if (faviconPath && faviconMime && fs.existsSync(faviconPath)) {
        res.type(faviconMime);
        res.set('Cache-Control', 'no-cache');
        return fs.createReadStream(faviconPath).pipe(res);
    }

    res.type('image/png');
    res.set('Cache-Control', 'no-cache');
    return fs.createReadStream(DEFAULT_FAVICON).pipe(res);
});

module.exports = router;
