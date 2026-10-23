/**
 * /api/backup routes: authenticated DB backup/export + import (FEAT-003).
 *
 *   - GET  /api/backup/export (requireAuth) -> a JSON attachment with streams +
 *     an allowlist of safe app_config keys (buildBackup).
 *   - GET  /api/backup/db     (requireAuth) -> the raw SQLite file as an
 *     octet-stream attachment (cheap full backup), 404 when missing.
 *   - POST /api/backup/import (requireAuth) -> validate + upsert streams by
 *     folder and apply ONLY allowlisted app_config keys, reporting
 *     imported/updated/skipped. Never touches users/sessions/jobs/schedules.
 *
 * The import body may exceed the global 100kb express.json limit, so this route
 * mounts a ROUTE-LOCAL express.json({ limit: '5mb' }) ahead of its handler.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const {
    buildBackup,
    pickSafeConfig,
    validateBackup,
} = require('../lib/backup');
const {
    getConfig,
    setConfig,
    ConfigValidationError,
} = require('../services/app-config');
const {
    listStreams,
    getStreamByFolder,
    createStream,
    updateStream,
    DuplicateFolderError,
} = require('../services/streams');

// The SQLite file lives on the ./data bind mount at a fixed container path (see
// db/index.js, which keeps DB_PATH private). Hardcoded here the same way
// routes/branding.js hardcodes the branding dir.
const DB_PATH = path.join('/usr/src/app/data', 'app.db');

/** YYYY-MM-DD in UTC for the export filename. */
function dateStamp() {
    return new Date().toISOString().slice(0, 10);
}

// GET /api/backup/export (requireAuth) — downloadable JSON backup.
router.get('/export', requireAuth, (req, res) => {
    try {
        const streams = listStreams();
        const config = {
            app_title: getConfig('app_title'),
            log_retention: getConfig('log_retention'),
            recorder_minute: getConfig('recorder_minute'),
            output_retention_count: getConfig('output_retention_count'),
        };
        const backup = buildBackup({ streams, config });

        res.set('Content-Type', 'application/json');
        res.set(
            'Content-Disposition',
            `attachment; filename="audiostreamlogger-backup-${dateStamp()}.json"`
        );
        return res.send(JSON.stringify(backup, null, 2));
    } catch (err) {
        console.error('Error building backup:', err);
        return res
            .status(500)
            .json({ error: `Internal Server Error: ${err.message}` });
    }
});

// GET /api/backup/db (requireAuth) — stream the raw SQLite file.
router.get('/db', requireAuth, (req, res) => {
    if (!fs.existsSync(DB_PATH)) {
        return res.status(404).json({ error: 'database file not found' });
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="app.db"');
    const stream = fs.createReadStream(DB_PATH);
    stream.on('error', (err) => {
        console.error('Error streaming app.db:', err);
        if (!res.headersSent) {
            res.status(500).json({
                error: `Internal Server Error: ${err.message}`,
            });
        } else {
            res.destroy(err);
        }
    });
    return stream.pipe(res);
});

// POST /api/backup/import (requireAuth) — upsert streams + apply safe config.
router.post('/import', requireAuth, express.json({ limit: '5mb' }), (req, res) => {
    const body = req.body || {};
    const { ok, errors, streams } = validateBackup(body);
    if (!ok) {
        return res.status(400).json({ error: errors.join('; ') });
    }

    let imported = 0;
    let updated = 0;
    const skipped = [];

    for (const entry of streams) {
        const stream = entry.stream || {};
        if (!entry.valid) {
            skipped.push({ folder: stream.folder ?? null, reason: entry.error });
            continue;
        }

        const fields = {
            country: stream.country,
            name: stream.name,
            folder: stream.folder,
            url: stream.url,
        };

        try {
            const existing = getStreamByFolder(stream.folder);
            if (existing) {
                updateStream(existing.id, fields);
                updated += 1;
            } else {
                createStream(fields);
                imported += 1;
            }
        } catch (err) {
            // DuplicateFolderError defensively (a concurrent create), or any
            // other write failure: skip-and-report rather than abort the import.
            const reason =
                err instanceof DuplicateFolderError
                    ? 'folder already in use'
                    : err.message;
            skipped.push({ folder: stream.folder ?? null, reason });
        }
    }

    const config_applied = [];
    const config_skipped = [];
    const safeConfig = pickSafeConfig(body.app_config);
    for (const [key, value] of Object.entries(safeConfig)) {
        try {
            setConfig(key, value);
            config_applied.push(key);
        } catch (err) {
            if (err instanceof ConfigValidationError) {
                config_skipped.push({ key, reason: err.error });
            } else {
                config_skipped.push({ key, reason: err.message });
            }
        }
    }

    return res.json({
        imported,
        updated,
        skipped,
        config_applied,
        config_skipped,
    });
});

module.exports = router;
