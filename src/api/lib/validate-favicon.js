/**
 * Pure validator for favicon uploads (POST /api/branding/favicon).
 *
 * No I/O, no DB — validateFaviconUpload({ contentType, byteLength }) returns
 * `null` on success or `{ field, error }` on the first failure, so the route can
 * map it straight to a 400 response.
 *
 * MIME_EXT maps the accepted content types to the file extension the api stores
 * the bytes under: png, the two common ICO MIME spellings, and SVG. Any other
 * type is rejected. The byte length must be positive and no larger than 1 MiB.
 */

const MAX_BYTES = 1024 * 1024; // 1 MiB

const MIME_EXT = {
    'image/png': 'png',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'image/svg+xml': 'svg',
};

/**
 * Validate an uploaded favicon by its Content-Type and byte length.
 * @param {{ contentType?: string, byteLength?: number }} input
 * @returns {null | { field: string, error: string }}
 */
function validateFaviconUpload({ contentType, byteLength } = {}) {
    const mime =
        typeof contentType === 'string'
            ? contentType.split(';')[0].trim().toLowerCase()
            : '';

    if (!Object.prototype.hasOwnProperty.call(MIME_EXT, mime)) {
        return { field: 'file', error: 'unsupported favicon type' };
    }

    if (typeof byteLength !== 'number' || byteLength <= 0) {
        return { field: 'file', error: 'empty favicon' };
    }

    if (byteLength > MAX_BYTES) {
        return { field: 'file', error: 'favicon too large' };
    }

    return null;
}

module.exports = { validateFaviconUpload, MIME_EXT, MAX_BYTES };
