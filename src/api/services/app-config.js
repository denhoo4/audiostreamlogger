/**
 * app_config scalar key/value data-access layer (design §1.3 / §1.4).
 *
 * getConfig(key)/setConfig(key, value) wrap the api write handle with per-key
 * validation on write: log_retention reuses the ported validateRetentionHours
 * (1..8760); the minute keys (recorder_minute) must be 0..59; output_retention_count
 * must parse to a positive integer. Values are stored as TEXT; the owning reader
 * re-validates defensively (NIT-5 — see parseOutputRetentionCount).
 */
const db = require('../db');
const {
    validateRetentionHours,
    parseOutputRetentionCount,
} = require('../lib/config-validate');

const MINUTE_KEYS = ['recorder_minute'];

class ConfigValidationError extends Error {
    constructor(key, error) {
        super(error);
        this.name = 'ConfigValidationError';
        this.field = key;
        this.error = error;
    }
}

/** Fetch a config value by key, or undefined if absent. */
function getConfig(key) {
    const row = db
        .prepare('SELECT value FROM app_config WHERE key = ?')
        .get(key);
    return row ? row.value : undefined;
}

/**
 * Validate `value` for `key` and upsert it. Throws ConfigValidationError on a
 * bad value. Returns the stored string value.
 */
function setConfig(key, value) {
    validateConfig(key, value);
    const stored = String(value);
    db.prepare(
        `INSERT INTO app_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, stored);
    return stored;
}

/** Per-key write validation. Throws ConfigValidationError on failure. */
function validateConfig(key, value) {
    const n = Number(value);

    if (key === 'log_retention') {
        const result = validateRetentionHours(n);
        if (!result.ok) {
            throw new ConfigValidationError(key, result.message);
        }
        return;
    }

    if (MINUTE_KEYS.includes(key)) {
        if (!Number.isInteger(n) || n < 0 || n > 59) {
            throw new ConfigValidationError(
                key,
                `${key} must be an integer between 0 and 59`
            );
        }
        return;
    }

    if (key === 'output_retention_count') {
        if (!Number.isInteger(n) || n < 1) {
            throw new ConfigValidationError(
                key,
                'output_retention_count must be a positive integer'
            );
        }
        return;
    }

    if (key === 'app_title') {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new ConfigValidationError(
                key,
                'app_title must be a non-empty string'
            );
        }
        if (value.trim().length > 200) {
            throw new ConfigValidationError(
                key,
                'app_title must be at most 200 characters'
            );
        }
        return;
    }

    // favicon_path / favicon_mime are written only by the api (after a validated
    // upload), so a non-empty string is the only constraint here.
    if (key === 'favicon_path' || key === 'favicon_mime') {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new ConfigValidationError(key, `${key} must be a non-empty string`);
        }
        return;
    }

    // worker_last_heartbeat / worker_status / worker_current_job_id are
    // informational status rows written DIRECTLY by the worker over its own
    // handle (not through setConfig). The passthrough branches here accept any
    // string so a future api-side setConfig on these keys does not throw.
    if (
        key === 'worker_last_heartbeat' ||
        key === 'worker_status' ||
        key === 'worker_current_job_id'
    ) {
        if (typeof value !== 'string') {
            throw new ConfigValidationError(key, `${key} must be a string`);
        }
        return;
    }

    throw new ConfigValidationError(key, `unknown config key: ${key}`);
}

module.exports = {
    getConfig,
    setConfig,
    parseOutputRetentionCount,
    ConfigValidationError,
};
