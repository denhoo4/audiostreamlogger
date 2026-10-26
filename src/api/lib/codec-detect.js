/**
 * Pure codec-detection helpers (FEAT-001) — NO I/O, NO child_process.
 *
 * These helpers turn the raw ffprobe-derived source description (a detected
 * codec name + bitrate + container format_name) into the two decisions the rest
 * of the system needs:
 *
 *   1. COPY vs TRANSCODE — isCopyEligible() answers "can the recorder stream-
 *      copy this source into the configured codec's container untouched?" It is
 *      true ONLY when the detected codec equals the configured codec AND the
 *      (codec, container) pair is in the proven COPY_ELIGIBLE allowlist. A
 *      copy preserves the original bytes (no resample / no re-encode); anything
 *      else transcodes to the configured codec/bitrate.
 *
 *   2. A UI SUGGESTION — suggestRecording() maps the detected source to the
 *      recording-quality shape the Test button pre-fills ({codec, bitrate_kbps,
 *      bit_depth}), snapping a detected lossy bitrate to the nearest value the
 *      codec actually allows and falling back to mp3/192 for anything we do not
 *      recognise as a recording codec.
 *
 * The codec value-domain (which codecs exist, their allowed bitrates / bit
 * depths) is owned by lib/validate-stream.js; this module imports CODECS from
 * there so the two never drift.
 */
const { CODECS } = require('./validate-stream');

/** Behaviour-preserving fallback when the source cannot be mapped to a codec. */
const FALLBACK = { codec: 'mp3', bitrate_kbps: 192, bit_depth: null };

/**
 * Proven copy-eligible (configured codec -> set of ffprobe container tokens).
 *
 * ffprobe's `format.format_name` for a demuxed stream is often a comma-joined
 * list of candidate demuxer names (e.g. "mov,mp4,m4a,3gp,3g2,mj2" or just
 * "mp3"/"aac"). We therefore test for TOKEN membership (any comma-separated
 * token matches), not strict string equality.
 *
 *   - mp3  copies from an 'mp3' container.
 *   - aac  copies from a raw-ADTS container, which ffprobe reports as 'aac'
 *          (and historically 'adts'); both tokens are accepted.
 *
 * opus and flac are intentionally absent: no copy path is proven for them, so
 * they always transcode.
 */
const COPY_ELIGIBLE = {
    mp3: new Set(['mp3']),
    aac: new Set(['aac', 'adts']),
};

/** Split an ffprobe format_name into its lowercased comma-separated tokens. */
function formatTokens(formatName) {
    if (typeof formatName !== 'string') {
        return [];
    }
    return formatName
        .toLowerCase()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
}

/**
 * True ONLY when the detected source codec equals the configured codec AND the
 * (configured codec, container) pair is in COPY_ELIGIBLE. Any mismatch, unknown
 * codec, non-eligible container, or missing input yields false (-> transcode).
 *
 * @param {string|null|undefined} configuredCodec  the stream's configured codec
 * @param {string|null|undefined} detectedCodec    ffprobe codec_name
 * @param {string|null|undefined} formatName       ffprobe format.format_name
 * @returns {boolean}
 */
function isCopyEligible(configuredCodec, detectedCodec, formatName) {
    if (
        typeof configuredCodec !== 'string' ||
        typeof detectedCodec !== 'string' ||
        detectedCodec !== configuredCodec
    ) {
        return false;
    }
    const containers = COPY_ELIGIBLE[configuredCodec];
    if (!containers) {
        return false;
    }
    return formatTokens(formatName).some((token) => containers.has(token));
}

/**
 * Snap a detected bitrate (kbps) to the nearest value the codec actually
 * allows. Returns null for a codec with no bitrate set (lossless) or an unknown
 * codec, and null when `kbps` is not a finite number. On a tie the lower
 * allowed bitrate wins (stable, conservative).
 *
 * @param {string} codec
 * @param {number} kbps
 * @returns {number|null}
 */
function snapBitrate(codec, kbps) {
    const spec = CODECS[codec];
    if (!spec || !Array.isArray(spec.bitrates) || spec.bitrates.length === 0) {
        return null;
    }
    if (typeof kbps !== 'number' || !Number.isFinite(kbps)) {
        return null;
    }
    let best = spec.bitrates[0];
    let bestDist = Math.abs(best - kbps);
    for (const candidate of spec.bitrates) {
        const dist = Math.abs(candidate - kbps);
        // Strictly-less keeps the first (lower) candidate on a tie.
        if (dist < bestDist) {
            best = candidate;
            bestDist = dist;
        }
    }
    return best;
}

/**
 * Map a detected source to the recording-quality shape the UI pre-fills.
 *
 *   - a known LOSSY recording codec (mp3/opus/aac) -> that codec with its
 *     detected bitrate snapped to the nearest allowed value (first allowed
 *     bitrate when none was detected);
 *   - the LOSSLESS codec (flac) -> flac at bit_depth 16 (the common default);
 *   - anything else / absent -> the mp3/192 fallback.
 *
 * @param {string|null|undefined} detectedCodec
 * @param {number|null|undefined} detectedKbps
 * @returns {{codec:string, bitrate_kbps:number|null, bit_depth:number|null}}
 */
function suggestRecording(detectedCodec, detectedKbps) {
    if (typeof detectedCodec !== 'string') {
        return { ...FALLBACK };
    }
    const spec = CODECS[detectedCodec];
    if (!spec) {
        return { ...FALLBACK };
    }
    if (spec.kind === 'lossy') {
        const snapped =
            snapBitrate(detectedCodec, detectedKbps) ?? spec.bitrates[0];
        return { codec: detectedCodec, bitrate_kbps: snapped, bit_depth: null };
    }
    // lossless (flac): suggest the common 16-bit depth, no bitrate.
    return { codec: detectedCodec, bitrate_kbps: null, bit_depth: 16 };
}

module.exports = {
    COPY_ELIGIBLE,
    FALLBACK,
    isCopyEligible,
    snapBitrate,
    suggestRecording,
};
