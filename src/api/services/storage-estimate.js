/**
 * Storage-estimate PURE calculation helper (TODO item 23).
 *
 * Projects how much disk the app will hold at steady state given the current
 * streams + retention window. Kept PURE (no fs, no DB, no clock) like the other
 * pure helpers in services/recordings.js / services/stream-health.js, so it is
 * node:test-covered without a database. The route injects the data (streams +
 * per-folder MEASURED bytes/hour + retention hours).
 *
 * ── Formula ──────────────────────────────────────────────────────────────
 * Per stream:  projectedBytes = bytesPerHour * retentionHours
 * Total:       sum of every stream's projectedBytes
 *
 * bytesPerHour is picked per stream:
 *   - MEASURED (preferred): the mean size_bytes over that stream's recent
 *     COMPLETE hour rows, supplied by the route as measuredByFolder[folder].
 *     Used whenever it is a finite number > 0  →  source: "measured".
 *   - THEORETICAL fallback (no measured rows): derived from the item-22 quality
 *     columns on the stream (codec / bitrate_kbps / bit_depth)  →  source:
 *     "estimated". See theoreticalBytesPerHour below.
 *
 * ── FLAC handling ────────────────────────────────────────────────────────
 * FLAC is lossless and has NO fixed bitrate, so a theoretical projection can
 * only be a coarse constant. FLAC_ESTIMATED_KBPS = 900 approximates typical
 * 16-bit / 44.1 kHz stereo FLAC throughput (~900 kbps); 24-bit sources are
 * scaled by bit_depth/16. This is intentionally conservative and only used
 * UNTIL real FLAC rows exist — once a stream has complete recordings the
 * MEASURED mean always wins and the "estimated" badge disappears. The coarse
 * approximation is surfaced to the operator via that badge in the panel.
 */

// Applied to a lossy stream with a null bitrate_kbps so a value is always
// produced; mirrors services/streams.js DEFAULT_QUALITY (mp3 @ 160 kbps).
const DEFAULT_LOSSY_KBPS = 160;

// Coarse 16-bit/44.1 kHz stereo FLAC throughput used only as a theoretical
// fallback (see header). Scaled up for higher bit depths.
const FLAC_ESTIMATED_KBPS = 900;
const FLAC_REFERENCE_BIT_DEPTH = 16;

/** Convert a kbps throughput to bytes per hour (kbps → bits/s → bytes/hour). */
function kbpsToBytesPerHour(kbps) {
    return (kbps * 1000 / 8) * 3600;
}

/**
 * THEORETICAL bytes/hour for a stream from its quality fields, used when no
 * measured mean is available. Lossy codecs (mp3/opus) use their CBR bitrate
 * (defaulting to DEFAULT_LOSSY_KBPS when bitrate_kbps is null). FLAC uses the
 * documented FLAC_ESTIMATED_KBPS constant scaled by bit_depth/16. An unknown
 * codec falls back to the lossy default so a value is always returned.
 */
function theoreticalBytesPerHour(stream) {
    const codec = (stream && stream.codec) || 'mp3';

    if (codec === 'flac') {
        const depth =
            Number(stream.bit_depth) > 0
                ? Number(stream.bit_depth)
                : FLAC_REFERENCE_BIT_DEPTH;
        const kbps = FLAC_ESTIMATED_KBPS * (depth / FLAC_REFERENCE_BIT_DEPTH);
        return kbpsToBytesPerHour(kbps);
    }

    // lossy (mp3 / opus) and any unknown codec
    const bitrate =
        Number(stream.bitrate_kbps) > 0
            ? Number(stream.bitrate_kbps)
            : DEFAULT_LOSSY_KBPS;
    return kbpsToBytesPerHour(bitrate);
}

/**
 * Project steady-state disk usage for the given streams + retention window.
 *
 * @param {object} args
 * @param {Array<{folder:string,name:string,codec?:string,bitrate_kbps?:number|null,bit_depth?:number|null}>} args.streams
 * @param {{[folder:string]: number}} [args.measuredByFolder] measured mean
 *   bytes/hour per stream_folder; a finite value > 0 marks the stream measured.
 * @param {number} args.retentionHours retention window in hours; a
 *   non-positive / NaN value is treated as 0 (no projection).
 * @returns {{perStream: Array<{folder:string,name:string,bytesPerHour:number,source:"measured"|"estimated",projectedBytes:number}>, totalProjectedBytes:number, retentionHours:number}}
 */
function estimateStorage({ streams, measuredByFolder, retentionHours }) {
    const hours =
        Number.isFinite(retentionHours) && retentionHours > 0
            ? retentionHours
            : 0;
    const measured = measuredByFolder || {};

    const perStream = (streams || []).map((stream) => {
        const measuredValue = measured[stream.folder];
        const hasMeasured =
            Number.isFinite(measuredValue) && measuredValue > 0;

        const bytesPerHour = hasMeasured
            ? measuredValue
            : theoreticalBytesPerHour(stream);
        const source = hasMeasured ? 'measured' : 'estimated';

        return {
            folder: stream.folder,
            name: stream.name,
            bytesPerHour,
            source,
            projectedBytes: bytesPerHour * hours,
        };
    });

    const totalProjectedBytes = perStream.reduce(
        (sum, s) => sum + s.projectedBytes,
        0
    );

    return { perStream, totalProjectedBytes, retentionHours: hours };
}

module.exports = {
    estimateStorage,
    theoreticalBytesPerHour,
    DEFAULT_LOSSY_KBPS,
    FLAC_ESTIMATED_KBPS,
};
