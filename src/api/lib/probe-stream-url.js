/**
 * Advisory reachability probe for a stream URL (TODO item 14).
 *
 * This is NOT a hard gate on create/update — the existing validateStream format
 * check (lib/validate-stream.js) stays the only save-path gate. This module
 * powers a separate, admin-triggered "Test" button: it answers "does this URL
 * answer like a reachable audio stream?" with a short, human-readable reason,
 * and NEVER throws to the client (except ProbeInputError for bad input, which
 * the route maps to 400).
 *
 * SECURITY / SSRF stance (admin-only feature):
 *   - requireAuth gates the route; only an authenticated admin can probe.
 *   - We re-validate via validateUrl → http(s) ONLY. No file:, ftp:, data:,
 *     etc. is ever dialed (ProbeInputError on anything else).
 *   - A hard overall timeout (PROBE_TIMEOUT_MS) bounds the whole probe so a
 *     hanging icecast/shoutcast socket can never hang the request.
 *   - We follow at most MAX_REDIRECTS http(s)-only hops (icecast/HLS commonly
 *     30x); a redirect to a non-http(s) scheme is rejected.
 *   - We read ONLY the response status + headers, then destroy the socket
 *     before consuming the audio body (no audio is downloaded).
 *   - Full IP/CIDR denylisting + DNS-rebinding guards are intentionally NOT
 *     implemented: this is an admin-only advisory check and such a denylist
 *     would also break legitimate radio hosts on private/CDN ranges. The
 *     transport uses node:http/node:https .request with no shell involved — the
 *     untrusted URL is NEVER interpolated into a shell string.
 *   - Raw internal errors are never echoed; every failure maps to a short,
 *     fixed-shape detail string.
 */
const http = require('node:http');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { validateUrl } = require('./validate-stream');
const { suggestRecording } = require('./codec-detect');

/** Hard overall timeout for the whole probe (connection + headers). */
const PROBE_TIMEOUT_MS = 6000;
/** Max http(s)-only redirect hops, sharing the single overall timeout budget. */
const MAX_REDIRECTS = 3;

/**
 * Input error for a malformed / non-http(s) URL. The route maps this to a 400
 * {error, field:'url'} — it is the ONLY thing probeStreamUrl throws.
 */
class ProbeInputError extends Error {
    constructor(message = 'invalid url') {
        super(message);
        this.name = 'ProbeInputError';
        this.field = 'url';
    }
}

// Content-type values (lowercased, parameters stripped) that indicate audio.
const AUDIO_CONTENT_TYPES = new Set([
    'application/ogg',
    'application/vnd.apple.mpegurl',
    'audio/mpegurl',
    'audio/x-mpegurl',
    'application/x-mpegurl',
    'application/mpegurl',
]);

/** Strip any `; charset=...` parameter and lowercase a content-type header. */
function normalizeContentType(raw) {
    if (typeof raw !== 'string') {
        return '';
    }
    return raw.split(';')[0].trim().toLowerCase();
}

/**
 * Pure classifier: decide reachable/not from a final response's status +
 * headers. Exported so every branch is unit-testable in isolation.
 *
 * reachable:true when status is 2xx AND the content looks like audio:
 *   - content-type is audio/* or a known playlist/ogg type, OR
 *   - any ICY header is present (shoutcast/icecast: icy-name, icy-br, ...).
 * Otherwise reachable:false with a short detail.
 *
 * @param {{status:number, headers:object}} resp
 * @returns {{reachable:boolean, status:number, contentType?:string, detail:string}}
 */
function classifyResponse({ status, headers }) {
    const h = headers || {};
    const contentTypeRaw =
        typeof h['content-type'] === 'string' ? h['content-type'] : undefined;
    const contentType = normalizeContentType(contentTypeRaw);

    if (typeof status !== 'number' || status < 200 || status >= 300) {
        return {
            reachable: false,
            status,
            ...(contentTypeRaw ? { contentType: contentTypeRaw } : {}),
            detail: `server returned HTTP ${status}`,
        };
    }

    const hasIcyHeader = Object.keys(h).some((k) =>
        k.toLowerCase().startsWith('icy-')
    );
    const isAudioType =
        contentType.startsWith('audio/') || AUDIO_CONTENT_TYPES.has(contentType);

    if (isAudioType || hasIcyHeader) {
        return {
            reachable: true,
            status,
            ...(contentTypeRaw ? { contentType: contentTypeRaw } : {}),
            detail: 'reachable audio stream',
        };
    }

    return {
        reachable: false,
        status,
        ...(contentTypeRaw ? { contentType: contentTypeRaw } : {}),
        detail: `not an audio stream (content-type: ${contentTypeRaw || 'unknown'})`,
    };
}

/**
 * Default transport: a thin wrapper over node:http/node:https .request chosen
 * by protocol. Returns the ClientRequest so the probe can attach events, set a
 * timeout, and abort. GET (not HEAD) — many icecast/shoutcast servers mishandle
 * HEAD but answer GET.
 *
 * @param {string} urlStr  an already-validated http(s) URL
 * @param {function} onResponse  called with the IncomingMessage
 * @returns {import('node:http').ClientRequest}
 */
function defaultRequest(urlStr, onResponse) {
    const parsed = new URL(urlStr);
    const transport = parsed.protocol === 'https:' ? https : http;
    // ARRAY/options form — the untrusted URL is parsed into discrete fields and
    // handed to the native client; it is NEVER interpolated into a shell string.
    const req = transport.request(
        parsed,
        { method: 'GET', headers: { 'user-agent': 'audiostreamlogger-probe' } },
        onResponse
    );
    return req;
}

/**
 * Parse an ffprobe `-of json` document into the detection fields we surface.
 * Pure and tolerant: any shape we do not recognise yields all-null. Reads the
 * FIRST audio stream's codec_name + bit_rate (ffprobe reports bit_rate in
 * bits/s; we convert to kbps) and the container's format.format_name.
 *
 * @param {object} doc  parsed ffprobe JSON
 * @returns {{detectedCodec:string|null, detectedBitrateKbps:number|null, formatName:string|null}}
 */
function parseFfprobeJson(doc) {
    const empty = {
        detectedCodec: null,
        detectedBitrateKbps: null,
        formatName: null,
    };
    if (!doc || typeof doc !== 'object') {
        return empty;
    }
    const streams = Array.isArray(doc.streams) ? doc.streams : [];
    const audio = streams.find((s) => s && s.codec_type === 'audio');

    const detectedCodec =
        audio && typeof audio.codec_name === 'string' ? audio.codec_name : null;

    // bit_rate may live on the audio stream or (for raw containers) only on
    // format; both are strings of bits/s. Prefer the stream value.
    let bitsPerSec = null;
    if (audio && audio.bit_rate != null) {
        bitsPerSec = Number(audio.bit_rate);
    } else if (doc.format && doc.format.bit_rate != null) {
        bitsPerSec = Number(doc.format.bit_rate);
    }
    const detectedBitrateKbps =
        typeof bitsPerSec === 'number' && Number.isFinite(bitsPerSec) && bitsPerSec > 0
            ? Math.round(bitsPerSec / 1000)
            : null;

    const formatName =
        doc.format && typeof doc.format.format_name === 'string'
            ? doc.format.format_name
            : null;

    return { detectedCodec, detectedBitrateKbps, formatName };
}

/**
 * Default ffprobe seam: run `ffprobe -v error -show_streams -show_format -of
 * json <url>` on an already-validated http(s) URL and return the parsed
 * detection fields. ARRAY argv (never a shell string); bounded by whatever is
 * left of the shared probe deadline; NEVER throws — any failure (spawn error,
 * non-zero exit, timeout, unparseable JSON) resolves to all-null so the caller
 * transcodes.
 *
 * @param {string} urlStr  an already-validated http(s) URL
 * @param {number} deadline  epoch-ms deadline shared with the HTTP probe
 * @returns {Promise<{detectedCodec:string|null, detectedBitrateKbps:number|null, formatName:string|null}>}
 */
function defaultRunFfprobe(urlStr, deadline) {
    const nullResult = {
        detectedCodec: null,
        detectedBitrateKbps: null,
        formatName: null,
    };
    return new Promise((resolve) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            resolve(nullResult);
            return;
        }
        execFile(
            'ffprobe',
            [
                '-v',
                'error',
                '-show_streams',
                '-show_format',
                '-of',
                'json',
                urlStr,
            ],
            { timeout: Math.max(1, remaining), maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
                if (err) {
                    resolve(nullResult);
                    return;
                }
                let doc;
                try {
                    doc = JSON.parse(stdout);
                } catch {
                    resolve(nullResult);
                    return;
                }
                resolve(parseFfprobeJson(doc));
            }
        );
    });
}

/**
 * Probe a single URL for reachability, following up to MAX_REDIRECTS http(s)
 * redirects within one shared timeout budget. Resolves (never rejects) with a
 * classified result; input validation failures are thrown as ProbeInputError
 * by the caller before this runs.
 *
 * The `request` seam lets tests inject a fake that invokes onResponse with a
 * stubbed { statusCode, headers, destroy() } (optionally an EventEmitter body)
 * or emits 'error' / 'timeout' — no real network, no child process.
 */
function probeOnce(urlStr, request, runFfprobe, deadline, redirectsLeft) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(result);
        };

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            finish({ reachable: false, detail: `timed out after ${PROBE_TIMEOUT_MS / 1000}s` });
            return;
        }

        let req;
        try {
            req = request(urlStr, (res) => {
                const status = res.statusCode;
                const headers = res.headers || {};

                // Redirect handling: follow up to MAX_REDIRECTS http(s) hops.
                if (
                    typeof status === 'number' &&
                    status >= 300 &&
                    status < 400 &&
                    headers.location
                ) {
                    // We have the headers we need; stop reading the body.
                    if (typeof res.destroy === 'function') {
                        res.destroy();
                    }
                    if (redirectsLeft <= 0) {
                        if (typeof req.destroy === 'function') req.destroy();
                        finish({
                            reachable: false,
                            status,
                            detail: 'too many redirects',
                        });
                        return;
                    }
                    let nextUrl;
                    try {
                        nextUrl = new URL(headers.location, urlStr).toString();
                    } catch {
                        if (typeof req.destroy === 'function') req.destroy();
                        finish({
                            reachable: false,
                            status,
                            detail: 'invalid redirect target',
                        });
                        return;
                    }
                    const nextProto = (() => {
                        try {
                            return new URL(nextUrl).protocol;
                        } catch {
                            return '';
                        }
                    })();
                    if (nextProto !== 'http:' && nextProto !== 'https:') {
                        if (typeof req.destroy === 'function') req.destroy();
                        finish({
                            reachable: false,
                            status,
                            detail: 'redirect to non-http(s) scheme',
                        });
                        return;
                    }
                    if (typeof req.destroy === 'function') req.destroy();
                    settled = true; // hand off to the next hop
                    probeOnce(
                        nextUrl,
                        request,
                        runFfprobe,
                        deadline,
                        redirectsLeft - 1
                    ).then(resolve);
                    return;
                }

                // Terminal response. Read ICY + content-type headers FIRST via
                // the pure classifier, then stop reading the body (we never
                // download the audio).
                const result = classifyResponse({ status, headers });
                if (typeof res.destroy === 'function') {
                    res.destroy();
                }
                if (typeof req.destroy === 'function') {
                    req.destroy();
                }

                // Source-codec detection: only probe a CONFIRMED terminal 2xx,
                // using the final resolved URL + shared deadline in scope. The
                // seam never throws; a failure yields all-null detection so the
                // recorder transcodes. The reachability verdict is unchanged;
                // probeStreamUrl backfills `suggested` + nulls for every branch.
                const is2xx =
                    typeof status === 'number' && status >= 200 && status < 300;
                if (!is2xx) {
                    finish(result);
                    return;
                }
                Promise.resolve()
                    .then(() => runFfprobe(urlStr, deadline))
                    .then(
                        (detection) => finish({ ...result, ...detection }),
                        () => finish(result)
                    );
            });
        } catch {
            finish({ reachable: false, detail: 'could not connect' });
            return;
        }

        req.on('error', (err) => {
            const code = err && err.code ? err.code : 'network error';
            finish({ reachable: false, detail: `could not connect: ${code}` });
        });

        // Bound this hop by whatever is left of the overall budget.
        req.setTimeout(Math.max(1, remaining), () => {
            if (typeof req.destroy === 'function') {
                req.destroy();
            }
            finish({
                reachable: false,
                detail: `timed out after ${PROBE_TIMEOUT_MS / 1000}s`,
            });
        });

        if (typeof req.end === 'function') {
            req.end();
        }
    });
}

/**
 * Probe whether `url` is a reachable audio stream and, on a terminal 2xx,
 * detect the source codec/bitrate/container via the injected ffprobe seam.
 *
 * The result ALWAYS carries the four detection fields so clients have a stable
 * shape: `detectedCodec`/`detectedBitrateKbps`/`formatName` are null on any
 * branch that did not (or could not) detect, and `suggested` is the recording-
 * quality pre-fill derived from the detection (mp3/192 fallback when nothing
 * was detected). Reachability itself is unchanged by detection, and the probe
 * still never throws to the client (except ProbeInputError for bad input).
 *
 * @param {string} url  the user-entered stream URL (untrusted admin input)
 * @param {{request?:function, now?:function, runFfprobe?:function}} [deps]
 *        injectable seams for tests (no real network / child process)
 * @returns {Promise<{reachable:boolean, status?:number, contentType?:string, detail:string, detectedCodec:string|null, detectedBitrateKbps:number|null, formatName:string|null, suggested:object}>}
 * @throws {ProbeInputError} if the url is malformed or not http(s)
 */
async function probeStreamUrl(
    url,
    { request = defaultRequest, now = Date.now, runFfprobe = defaultRunFfprobe } = {}
) {
    const invalid = validateUrl(url);
    if (invalid) {
        throw new ProbeInputError(invalid.error);
    }
    const deadline = now() + PROBE_TIMEOUT_MS;
    const result = await probeOnce(url, request, runFfprobe, deadline, MAX_REDIRECTS);

    // Backfill the detection contract on EVERY branch so the shape is stable.
    const detectedCodec =
        typeof result.detectedCodec === 'string' ? result.detectedCodec : null;
    const detectedBitrateKbps =
        typeof result.detectedBitrateKbps === 'number'
            ? result.detectedBitrateKbps
            : null;
    const formatName =
        typeof result.formatName === 'string' ? result.formatName : null;

    return {
        ...result,
        detectedCodec,
        detectedBitrateKbps,
        formatName,
        suggested: suggestRecording(detectedCodec, detectedBitrateKbps),
    };
}

module.exports = {
    probeStreamUrl,
    classifyResponse,
    parseFfprobeJson,
    defaultRunFfprobe,
    ProbeInputError,
    PROBE_TIMEOUT_MS,
    MAX_REDIRECTS,
};
