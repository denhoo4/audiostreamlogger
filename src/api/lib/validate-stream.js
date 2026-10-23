/**
 * Pure validators for stream write-path input (POST/PUT /api/streams).
 *
 * No I/O, no DB — each validator returns `null` on success or `{ field, error }`
 * on the first failure, so callers can map it straight to a 400 response.
 *
 * The set of valid ISO 3166-1 alpha-2 codes is built ONCE at module load from
 * the bundled lib/iso-3166-1.json; the api validates the submitted `country`
 * against this set (membership + uppercase), which is the authoritative
 * value-domain rule (the DB only keeps a cheap length-2 backstop — design §2.3).
 *
 * NOTE: the folder allowlist here is ^[a-z0-9_-]+$ (lowercase-only). This is
 * INTENTIONALLY stricter than the read-path selection-export validator in
 * routes/util.js, which allows ^[A-Za-z0-9_-]+$ (uppercase permitted). The two
 * rules must NOT be harmonized: folders are created only through this new CRUD
 * going forward, so the stricter write rule is the canonical form while the
 * looser read rule stays backward-compatible with any existing uppercase folder
 * (design §2.4 Casing note).
 */
// Bundled static code asset — lives under lib/ (NOT under data/, which is the
// runtime SQLite volume mount point /usr/src/app/data; a bundled asset there
// would be shadowed by the ./data bind mount and vanish at runtime).
const isoCountries = require('./iso-3166-1.json');

const VALID_COUNTRY_CODES = new Set(isoCountries.map((c) => c.code));

const FOLDER_RE = /^[a-z0-9_-]+$/;

function validateFolder(folder) {
    if (typeof folder !== 'string' || !FOLDER_RE.test(folder)) {
        return { field: 'folder', error: 'invalid folder' };
    }
    return null;
}

function validateName(name) {
    if (typeof name !== 'string' || name.trim() === '') {
        return { field: 'name', error: 'name is required' };
    }
    return null;
}

function validateUrl(url) {
    if (typeof url !== 'string' || url.trim() === '') {
        return { field: 'url', error: 'url is required' };
    }
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { field: 'url', error: 'invalid url' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { field: 'url', error: 'invalid url' };
    }
    return null;
}

function validateCountry(country) {
    if (
        typeof country !== 'string' ||
        country.length !== 2 ||
        country !== country.toUpperCase() ||
        !VALID_COUNTRY_CODES.has(country)
    ) {
        return { field: 'country', error: 'invalid country' };
    }
    return null;
}

/**
 * Validate a full stream payload. Returns the first {field, error} found, or
 * null when every field is valid.
 */
function validateStream(stream) {
    const s = stream || {};
    return (
        validateCountry(s.country) ||
        validateName(s.name) ||
        validateFolder(s.folder) ||
        validateUrl(s.url) ||
        null
    );
}

module.exports = {
    validateStream,
    validateFolder,
    validateName,
    validateUrl,
    validateCountry,
    VALID_COUNTRY_CODES,
};
