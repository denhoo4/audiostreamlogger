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

test('2xx + audio/mpeg → reachable with status + contentType', async () => {
    const request = makeFakeRequest({
        [URL1]: { kind: 'response', status: 200, headers: { 'content-type': 'audio/mpeg' } },
    });
    const r = await probeStreamUrl(URL1, { request });
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
    const r = await probeStreamUrl(URL1, { request });
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
    const r = await probeStreamUrl(URL1, { request });
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
    const r = await probeStreamUrl(hop1, { request });
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
