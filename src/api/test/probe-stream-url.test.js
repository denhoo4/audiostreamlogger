/**
 * Unit coverage for the advisory stream-reachability probe
 * (lib/probe-stream-url.js). No real network and no child process: the http
 * transport is INJECTED as a fake `request` that invokes the response callback
 * with a stubbed { statusCode, headers, destroy() } or emits 'error'/'timeout'.
 *
 * Covers the classifier branches (2xx+audio / 2xx+ICY / 2xx+HLS → reachable;
 * 2xx+non-audio / non-2xx → not reachable), connect error, timeout, a redirect
 * chain within the hop cap, a redirect to a non-http(s) scheme, and the
 * ProbeInputError for malformed / non-http(s) input.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const {
    probeStreamUrl,
    classifyResponse,
    ProbeInputError,
} = require('../lib/probe-stream-url');

/**
 * Build a fake ClientRequest-like object. `plan` describes what the fake does
 * when `.end()` is called: respond with a stub response, emit an error, or fire
 * its timeout handler. Keyed by URL so a redirect chain can hand off hop-by-hop.
 */
function makeFakeRequest(planByUrl) {
    return function fakeRequest(urlStr, onResponse) {
        const req = new EventEmitter();
        let timeoutCb = null;
        req.setTimeout = (_ms, cb) => {
            timeoutCb = cb;
        };
        req.destroy = () => {};
        req.end = () => {
            const plan = planByUrl[urlStr];
            if (!plan) {
                queueMicrotask(() => req.emit('error', { code: 'ENOTFOUND' }));
                return;
            }
            if (plan.kind === 'error') {
                queueMicrotask(() => req.emit('error', plan.err || {}));
                return;
            }
            if (plan.kind === 'timeout') {
                queueMicrotask(() => timeoutCb && timeoutCb());
                return;
            }
            // kind === 'response'
            const res = new EventEmitter();
            res.statusCode = plan.status;
            res.headers = plan.headers || {};
            res.destroy = () => {};
            queueMicrotask(() => onResponse(res));
        };
        return req;
    };
}

const URL1 = 'https://radio.example.com/stream';

// Hermetic ffprobe stub: the existing reachability tests must never spawn the
// real `ffprobe` on a terminal 2xx. The detector's own branches are covered by
// the dedicated runFfprobe tests further below.
const NOOP_FFPROBE = async () => ({
    detectedCodec: null,
    detectedBitrateKbps: null,
    formatName: null,
});

test('2xx + audio/mpeg → reachable with status + contentType', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/mpeg' } },
    });
    const r = await probeStreamUrl(URL1, { request, runFfprobe: NOOP_FFPROBE });
    assert.strictEqual(r.reachable, true);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.contentType, 'audio/mpeg');
});

test('2xx + ICY header (shoutcast) → reachable even without an audio content-type', async () => {
    const request = makeFakeRequest({
        [URL1]: {
            kind: 'response',
            status: 200,
            headers: { 'content-type': 'text/html', 'icy-name': 'My Radio' },
        },
    });
    const r = await probeStreamUrl(URL1, { request, runFfprobe: NOOP_FFPROBE });
    assert.strictEqual(r.reachable, true);
    assert.strictEqual(r.status, 200);
});

test('2xx + HLS playlist (application/vnd.apple.mpegurl) → reachable', async () => {
    const request = makeFakeRequest({
        [URL1]: {
            kind: 'response',
            status: 200,
            headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        },
    });
    const r = await probeStreamUrl(URL1, { request, runFfprobe: NOOP_FFPROBE });
    assert.strictEqual(r.reachable, true);
});

test('2xx + text/html → not reachable (non-audio content-type)', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 200, headers: { 'content-type': 'text/html' } },
    });
    const r = await probeStreamUrl(URL1, { request });
    assert.strictEqual(r.reachable, false);
    assert.match(r.detail, /not an audio stream/);
    assert.match(r.detail, /text\/html/);
});

test('404 → not reachable ("server returned HTTP 404")', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 404, headers: {} },
    });
    const r = await probeStreamUrl(URL1, { request });
    assert.strictEqual(r.reachable, false);
    assert.strictEqual(r.status, 404);
    assert.match(r.detail, /HTTP 404/);
});

test('connection error (ENOTFOUND) → not reachable ("could not connect")', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'error', err: { code: 'ENOTFOUND' } },
    });
    const r = await probeStreamUrl(URL1, { request });
    assert.strictEqual(r.reachable, false);
    assert.match(r.detail, /could not connect/);
    assert.match(r.detail, /ENOTFOUND/);
});

test('timeout → not reachable ("timed out after 6s")', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'timeout' },
    });
    const r = await probeStreamUrl(URL1, { request });
    assert.strictEqual(r.reachable, false);
    assert.match(r.detail, /timed out after 6s/);
});

test('redirect chain within the hop cap resolving to an audio 2xx → reachable', async () => {
    const hop1 = 'https://radio.example.com/stream';
    const hop2 = 'https://cdn.example.com/live';
    const request = makeFakeRequest({
        [hop1]: { kind: 'response', status: 302, headers: { location: hop2 } },
        [hop2]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/aac' } },
    });
    const r = await probeStreamUrl(hop1, { request, runFfprobe: NOOP_FFPROBE });
    assert.strictEqual(r.reachable, true);
    assert.strictEqual(r.contentType, 'audio/aac');
});

test('redirect to a non-http(s) scheme → not reachable', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 302, headers: { location: 'ftp://evil.example/x' } },
    });
    const r = await probeStreamUrl(URL1, { request });
    assert.strictEqual(r.reachable, false);
    assert.match(r.detail, /non-http/);
});

test('too many redirects → not reachable', async () => {
    // Four hops but the cap is 3: the fourth resolution never classifies audio.
    const a = 'https://a.example.com/';
    const b = 'https://b.example.com/';
    const c = 'https://c.example.com/';
    const d = 'https://d.example.com/';
    const e = 'https://e.example.com/';
    const request = makeFakeRequest({
        [a]: { kind: 'response', status: 302, headers: { location: b } },
        [b]: { kind: 'response', status: 302, headers: { location: c } },
        [c]: { kind: 'response', status: 302, headers: { location: d } },
        [d]: { kind: 'response', status: 302, headers: { location: e } },
    });
    const r = await probeStreamUrl(a, { request });
    assert.strictEqual(r.reachable, false);
    assert.match(r.detail, /too many redirects/);
});

test('malformed url → throws ProbeInputError', async () => {
    await assert.rejects(() => probeStreamUrl('not-a-url'), ProbeInputError);
});

test('non-http(s) scheme (file:) → throws ProbeInputError, never probed', async () => {
    let called = false;
    const request = () => {
        called = true;
        throw new Error('should not be called');
    };
    await assert.rejects(
        () => probeStreamUrl('file:///etc/passwd', { request }),
        ProbeInputError
    );
    assert.strictEqual(called, false, 'transport must not be called for a non-http(s) scheme');
});

// --- source-codec detection via the injected runFfprobe seam (FEAT-001) ----

test('detected aac + bitrate on a 2xx audio response → suggested aac snapped', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/aac' } },
    });
    const runFfprobe = async () => ({
        detectedCodec: 'aac',
        detectedBitrateKbps: 190,
        formatName: 'aac',
    });
    const r = await probeStreamUrl(URL1, { request, runFfprobe });
    assert.strictEqual(r.reachable, true);
    assert.strictEqual(r.detectedCodec, 'aac');
    assert.strictEqual(r.detectedBitrateKbps, 190);
    assert.strictEqual(r.formatName, 'aac');
    assert.deepStrictEqual(r.suggested, {
        codec: 'aac',
        bitrate_kbps: 192,
        bit_depth: null,
    });
});

test('unknown detected codec → suggested mp3/192 fallback', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/mpeg' } },
    });
    const runFfprobe = async () => ({
        detectedCodec: 'vorbis',
        detectedBitrateKbps: 128,
        formatName: 'ogg',
    });
    const r = await probeStreamUrl(URL1, { request, runFfprobe });
    assert.strictEqual(r.reachable, true);
    assert.strictEqual(r.detectedCodec, 'vorbis');
    assert.deepStrictEqual(r.suggested, {
        codec: 'mp3',
        bitrate_kbps: 192,
        bit_depth: null,
    });
});

test('ffprobe failure (all-null) → detected* null + mp3/192 fallback, still reachable', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/mpeg' } },
    });
    const runFfprobe = async () => ({
        detectedCodec: null,
        detectedBitrateKbps: null,
        formatName: null,
    });
    const r = await probeStreamUrl(URL1, { request, runFfprobe });
    assert.strictEqual(r.reachable, true);
    assert.strictEqual(r.detectedCodec, null);
    assert.strictEqual(r.detectedBitrateKbps, null);
    assert.strictEqual(r.formatName, null);
    assert.deepStrictEqual(r.suggested, {
        codec: 'mp3',
        bitrate_kbps: 192,
        bit_depth: null,
    });
});

test('a thrown/rejected ffprobe seam never breaks the probe (null detection)', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/mpeg' } },
    });
    const runFfprobe = async () => {
        throw new Error('ffprobe boom');
    };
    const r = await probeStreamUrl(URL1, { request, runFfprobe });
    assert.strictEqual(r.reachable, true);
    assert.strictEqual(r.detectedCodec, null);
    assert.deepStrictEqual(r.suggested, {
        codec: 'mp3',
        bitrate_kbps: 192,
        bit_depth: null,
    });
});

test('ICY/content-type verdict is read FIRST; ffprobe only runs on a terminal 2xx', async () => {
    // A 404 must NOT invoke ffprobe (headers-first precedence) and still yields
    // the stable detection contract with null detection + mp3/192 fallback.
    let probed = false;
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 404, headers: {} },
    });
    const runFfprobe = async () => {
        probed = true;
        return { detectedCodec: 'aac', detectedBitrateKbps: 192, formatName: 'aac' };
    };
    const r = await probeStreamUrl(URL1, { request, runFfprobe });
    assert.strictEqual(probed, false, 'ffprobe must not run on a non-2xx response');
    assert.strictEqual(r.reachable, false);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.detectedCodec, null);
    assert.deepStrictEqual(r.suggested, {
        codec: 'mp3',
        bitrate_kbps: 192,
        bit_depth: null,
    });
});

test('non-reachable branches (connect error) still carry the detection contract', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'error', err: { code: 'ENOTFOUND' } },
    });
    const r = await probeStreamUrl(URL1, { request, runFfprobe: async () => ({}) });
    assert.strictEqual(r.reachable, false);
    assert.strictEqual(r.detectedCodec, null);
    assert.deepStrictEqual(r.suggested, {
        codec: 'mp3',
        bitrate_kbps: 192,
        bit_depth: null,
    });
});

test('ffprobe runs on the FINAL resolved URL after a redirect chain', async () => {
    const hop1 = 'https://radio.example.com/stream';
    const hop2 = 'https://cdn.example.com/live';
    const request = makeFakeRequest({
        [hop1]: { kind: 'response', status: 302, headers: { location: hop2 } },
        [hop2]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/aac' } },
    });
    let probedUrl = null;
    const runFfprobe = async (url) => {
        probedUrl = url;
        return { detectedCodec: 'aac', detectedBitrateKbps: 256, formatName: 'adts' };
    };
    const r = await probeStreamUrl(hop1, { request, runFfprobe });
    assert.strictEqual(probedUrl, hop2, 'ffprobe uses the final resolved URL');
    assert.strictEqual(r.reachable, true);
    assert.deepStrictEqual(r.suggested, {
        codec: 'aac',
        bitrate_kbps: 256,
        bit_depth: null,
    });
});

test('classifyResponse is a pure, independently testable helper', () => {
    assert.strictEqual(
        classifyResponse({ status: 200, headers: { 'content-type': 'audio/ogg' } }).reachable,
        true
    );
    assert.strictEqual(
        classifyResponse({ status: 500, headers: {} }).reachable,
        false
    );
    assert.strictEqual(
        classifyResponse({ status: 200, headers: { 'content-type': 'audio/mpeg; charset=utf-8' } })
            .reachable,
        true
    );
});
