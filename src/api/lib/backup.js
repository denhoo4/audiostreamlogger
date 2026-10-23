/**
 * Pure helpers for the DB backup/export + import feature (FEAT-003).
 *
 * No DB, no I/O: the route (routes/backup.js) supplies the already-read streams
 * + config and performs all persistence. These functions only shape and
 * validate data so they are trivially unit-testable with node:test.
 *
 * The import path is deliberately narrow: ONLY streams and an allowlist of safe
 * app_config keys ever cross the boundary. Users, sessions, jobs and schedules
 * are never part of a backup and can never be written by an import.
 */
const { validateStream } = require('./validate-stream');

// app_config keys that are safe to export AND to apply on import. Anything else
// (favicon_path, worker_* status rows, future secrets) is dropped on both sides.
const SAFE_CONFIG_KEYS = [
    'app_title',
    'log_retention',
    'recorder_minute',
    'output_retention_count',
];

const BACKUP_VERSION = 1;

/** The four public stream fields, in a stable order, for a backup entry. */
function pickStreamFields(stream) {
    const s = stream || {};
    return {
        country: s.country,
        name: s.name,
        folder: s.folder,
        url: s.url,
    };
}

/** Keep only allowlisted keys from a config object; returns a new object. */
function pickSafeConfig(configObj) {
    const out = {};
    if (!configObj || typeof configObj !== 'object') {
        return out;
    }
    for (const key of SAFE_CONFIG_KEYS) {
        if (Object.prototype.hasOwnProperty.call(configObj, key)) {
            const value = configObj[key];
            if (value !== undefined && value !== null) {
                out[key] = value;
            }
        }
    }
    return out;
}

/**
 * Build the export payload. `exported_at` is supplied by the caller (or set to
 * the current ISO time when omitted) so tests can assert a fixed value.
 */
function buildBackup({ streams, config, exported_at } = {}) {
    const streamList = Array.isArray(streams) ? streams : [];
    return {
        version: BACKUP_VERSION,
        exported_at: exported_at || new Date().toISOString(),
        streams: streamList.map(pickStreamFields),
        app_config: pickSafeConfig(config),
    };
}

/**
 * Validate a backup object for import. Returns { ok, errors, streams } where
 * `streams` is a per-entry report ({ index, stream, valid, error }) so the route
 * can skip-and-report an invalid entry instead of rejecting the whole import.
 */
function validateBackup(obj) {
    const errors = [];
    const b = obj || {};

    if (b.version !== BACKUP_VERSION) {
        errors.push(`unsupported backup version: ${b.version}`);
    }

    if (!Array.isArray(b.streams)) {
        errors.push('streams must be an array');
    }

    if (
        b.app_config !== undefined &&
        (b.app_config === null || typeof b.app_config !== 'object' || Array.isArray(b.app_config))
    ) {
        errors.push('app_config must be an object');
    }

    const streams = Array.isArray(b.streams)
        ? b.streams.map((stream, index) => {
              const invalid = validateStream(stream);
              return {
                  index,
                  stream,
                  valid: invalid === null,
                  error: invalid ? invalid.error : null,
              };
          })
        : [];

    return { ok: errors.length === 0, errors, streams };
}

module.exports = {
    SAFE_CONFIG_KEYS,
    BACKUP_VERSION,
    buildBackup,
    pickSafeConfig,
    validateBackup,
};
