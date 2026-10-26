/**
 * Bounded ffprobe source-codec detector for the recorder copy decision (FEAT-002).
 *
 * `detectSource(url, { runFfprobe } = {})` probes a stream URL and RESOLVES
 *   { codec, formatName } | null
 * and NEVER rejects — ANY spawn/parse/timeout/bad-input failure resolves `null`
 * so the supervisor falls back to a plain transcode (design: "detectSource
 * RESOLVES null on any failure -> transcode"). The default `runFfprobe` shells
 * out to ffprobe with ARRAY args (never a shell string — NFR-3), http/https-only
 * input, and a bounded ~8s timeout matching the supervisor's probe window so a
 * hung/slow source can never stall the start of a recording.
 *
 * This module deliberately does NOT import any api module. The copy-eligibility
 * value-domain is mirrored here as a tiny local constant (the same cross-service
 * CODECS-duplication convention used by encoding.js), so recorder.js can ask
 * `isCopyEligible(configuredCodec, detected)` without a cross-service import.
 * The pairs match src/api/lib/codec-detect.js COPY_ELIGIBLE exactly:
 *   mp3 -> {'mp3'},  aac -> {'aac','adts'}  (opus/flac have no copy path).
 */
const { execFile } = require('child_process');

// Bounded probe window — matches the supervisor's tolerance for the <=8s window
// during which a SIGTERM must still be honoured (see superviseStream).
const PROBE_TIMEOUT_MS = 8000;

// Local mirror of the api's COPY_ELIGIBLE (src/api/lib/codec-detect.js). ffprobe
// reports format.format_name as a comma-joined candidate list, so membership is
// tested per comma-separated TOKEN, not by strict string equality.
const COPY_ELIGIBLE = {
    mp3: new Set(['mp3']),
    aac: new Set(['aac', 'adts']),
};

/** Split an ffprobe format_name into lowercased, trimmed, non-empty tokens. */
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
 * (configured codec, container) pair is copy-eligible. `detected` is the object
 * detectSource resolved ({ codec, formatName }) or null. Any null/mismatch/
 * non-eligible container yields false (-> transcode).
 *
 * @param {string|null|undefined} configuredCodec
 * @param {{codec:string, formatName:string|null}|null|undefined} detected
 * @returns {boolean}
 */
function isCopyEligible(configuredCodec, detected) {
    if (typeof configuredCodec !== 'string' || !detected || typeof detected.codec !== 'string') {
        return false;
    }
    if (detected.codec !== configuredCodec) {
        return false;
    }
    const containers = COPY_ELIGIBLE[configuredCodec];
    if (!containers) {
        return false;
    }
    return formatTokens(detected.formatName).some((token) => containers.has(token));
}

/**
 * Parse ffprobe's `-of json` stdout into { codec, formatName } | null. Returns
 * null for unparseable JSON, no audio stream, or a missing codec_name. Never
 * throws.
 *
 * @param {string} stdout
 * @returns {{codec:string, formatName:string|null}|null}
 */
function parseFfprobeJson(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') {
        return null;
    }
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const hasAnyType = streams.some((s) => s && typeof s.codec_type === 'string');
    // Prefer an explicit audio stream. Only when NO stream carries a codec_type
    // at all (older/odd ffprobe output) do we fall back to the first stream with
    // a codec_name — a video-only input with a codec_type must resolve null.
    const audio = streams.find((s) => s && s.codec_type === 'audio')
        || (!hasAnyType ? streams.find((s) => s && typeof s.codec_name === 'string') : undefined);
    if (!audio || typeof audio.codec_name !== 'string' || audio.codec_name === '') {
        return null;
    }
    const formatName =
        parsed.format && typeof parsed.format.format_name === 'string'
            ? parsed.format.format_name
            : null;
    return { codec: audio.codec_name, formatName };
}

/**
 * Default ffprobe runner: execFile with ARRAY args (never a shell string),
 * http/https-only input, bounded timeout. RESOLVES the raw stdout string on a
 * clean exit and RESOLVES null on any spawn/exit/timeout error (never rejects).
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
function defaultRunFfprobe(url) {
    return new Promise((resolve) => {
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
            resolve(null);
            return;
        }
        execFile(
            'ffprobe',
            ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', url],
            { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
                if (err) {
                    resolve(null);
                    return;
                }
                resolve(typeof stdout === 'string' ? stdout : stdout?.toString?.() ?? null);
            },
        );
    });
}

/**
 * Probe a stream URL for its source audio codec + container. RESOLVES
 * { codec, formatName } on a clean probe and RESOLVES null on ANY failure.
 * NEVER rejects. `runFfprobe` is injectable for tests (default: ffprobe).
 *
 * The injected/default runFfprobe may resolve either the raw ffprobe JSON string
 * OR an already-parsed { codec, formatName } object (the latter lets tests avoid
 * serialising JSON); both shapes are accepted here.
 *
 * @param {string} url
 * @param {{ runFfprobe?: (url:string)=>Promise<any> }} [opts]
 * @returns {Promise<{codec:string, formatName:string|null}|null>}
 */
async function detectSource(url, { runFfprobe = defaultRunFfprobe } = {}) {
    try {
        const out = await runFfprobe(url);
        if (out == null) {
            return null;
        }
        if (typeof out === 'string') {
            return parseFfprobeJson(out);
        }
        // Already-parsed object: accept a well-formed { codec, formatName }.
        if (typeof out === 'object' && typeof out.codec === 'string' && out.codec !== '') {
            const formatName = typeof out.formatName === 'string' ? out.formatName : null;
            return { codec: out.codec, formatName };
        }
        return null;
    } catch {
        // Belt-and-braces: a throwing injected runFfprobe still resolves null.
        return null;
    }
}

module.exports = {
    detectSource,
    isCopyEligible,
    parseFfprobeJson,
    defaultRunFfprobe,
    COPY_ELIGIBLE,
    PROBE_TIMEOUT_MS,
};
