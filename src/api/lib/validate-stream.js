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

// Per-stream recording-quality allowlist (design §4/§7). codec is compared
// case-sensitively against this lowercase allowlist (reject 'MP3'), mirroring
// the strict folder/country posture. Lossy codecs take a bitrate from a fixed
// set and forbid bit_depth; the lossless codec takes a bit_depth from {16,24}
// and forbids a bitrate. This is the authoritative value-domain gate — the DB
// keeps only the NOT NULL DEFAULT 'mp3' shape backstop (no CHECK), and the
// recorder clamps defensively.
const CODECS = {
    mp3: { kind: 'lossy', bitrates: [96, 128, 160, 192, 256, 320] },
    opus: { kind: 'lossy', bitrates: [64, 96, 128, 160, 192] },
    flac: { kind: 'lossless', bitDepths: [16, 24] },
};

function isPresent(value) {
    return value !== undefined && value !== null;
}

/**
 * Validate the per-stream quality fields (codec / bitrate_kbps / bit_depth).
 * Returns the first {field, error} found, or null when the combination is
 * valid. When all three fields are absent the combination is valid: the service
 * layer fills the behaviour-preserving mp3 default (design §7).
 */
function validateQuality(stream) {
    const { codec, bitrate_kbps, bit_depth } = stream;

    // All-absent is valid — the service normalises to the mp3 default.
    if (!isPresent(codec) && !isPresent(bitrate_kbps) && !isPresent(bit_depth)) {
        return null;
    }

    if (typeof codec !== 'string' || !Object.prototype.hasOwnProperty.call(CODECS, codec)) {
        return { field: 'codec', error: 'invalid codec' };
    }
    const spec = CODECS[codec];

    if (spec.kind === 'lossy') {
        if (
            typeof bitrate_kbps !== 'number' ||
            !Number.isInteger(bitrate_kbps) ||
            !spec.bitrates.includes(bitrate_kbps)
        ) {
            return { field: 'bitrate_kbps', error: 'invalid bitrate' };
        }
        if (isPresent(bit_depth)) {
            return {
                field: 'bit_depth',
                error: 'bit_depth not allowed for a lossy codec',
            };
        }
        return null;
    }

    // lossless (flac)
    if (
        typeof bit_depth !== 'number' ||
        !Number.isInteger(bit_depth) ||
        !spec.bitDepths.includes(bit_depth)
    ) {
        return { field: 'bit_depth', error: 'invalid bit_depth' };
    }
    if (isPresent(bitrate_kbps)) {
        return {
            field: 'bitrate_kbps',
            error: 'bitrate not allowed for a lossless codec',
        };
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
        validateQuality(s) ||
        null
    );
}

module.exports = {
    validateStream,
    validateFolder,
    validateName,
    validateUrl,
    validateCountry,
    validateQuality,
    CODECS,
    VALID_COUNTRY_CODES,
};
