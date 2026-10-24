/**
 * Integration coverage for the /api/analysis router (routes/analysis.js):
 * summary + gaps, EVERYTHING behind requireAuth (no public analysis surface).
 *
 * Reuses the FEAT-001 temp-DB injection + fake-session ephemeral-server pattern.
 * A few recordings rows are seeded via the service's upsertRecording(handle,...)
 * so the summary/gaps shapes are exercised against real data. The pure analysis
 * helpers themselves are covered by recordings.test.js; this suite proves the
 * HTTP wiring, the auth gate, and the validation branches.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');

let tmpDir;
let db;
let server;
let baseUrl;
let authenticated = true;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-analysisroutes-'));
    const dbPath = path.join(tmpDir, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');

    const dbModulePath = require.resolve('../db');
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: db,
    };

    applySchema(db);
    const recordings = require('../services/recordings');

    // Seed two hour-slots for one folder on 2026-01-01 (00 + 01), leaving the
    // rest of that day missing so the gaps shape has a known present/missing mix.
    recordings.upsertRecording(db, {
        stream_folder: 'nl_one',
        date: '2026-01-01',
        hour: '00',
        file_path: '/audio/nl_one/nl_one-2026-01-01-00.mp3',
        status: 'complete',
        duration_seconds: 3600,
        size_bytes: 1000,
        segment_count: 1,
    });
    recordings.upsertRecording(db, {
        stream_folder: 'nl_one',
        date: '2026-01-01',
        hour: '01',
        file_path: '/audio/nl_one/nl_one-2026-01-01-01.mp3',
        status: 'complete',
        duration_seconds: 3600,
        size_bytes: 2000,
        segment_count: 1,
    });

    // Seed streams for the stream-health route (it joins the `streams` table).
    // nl_ok gets fresh "now"-relative complete rows so it is ok; nl_never has
    // no recordings at all so it classifies as never. The ok stream uses its
    // OWN folder (nl_ok) so the fixed-date summary/gaps assertions on nl_one
    // above stay exact. Because the route derives its window from the server
    // clock, seed the ok stream relative to new Date().
    const streams = require('../services/streams');
    streams.createStream({
        country: 'NL',
        name: 'NL OK',
        folder: 'nl_ok',
        url: 'https://example.com/nl_ok',
    });
    streams.createStream({
        country: 'NL',
        name: 'NL Never',
        folder: 'nl_never',
        url: 'https://example.com/nl_never',
    });
    // nl_down models a stream that recorded in the past and then STOPPED: its
    // only complete row is far older than any health window, so the route's
    // window-scoped listRecentByDate never fetches it — but the all-time
    // latestCompleteByFolder lookup does. It must classify `down`, NOT `never`.
    // (This is the regression the reviewer flagged: stopped-and-down vs
    // brand-new must be distinguishable through the REAL endpoint.) The old row
    // itself is seeded inside the stream-health test, not here, so the
    // fixed-date summary/gaps assertions on nl_one only (one folder) stay exact.
    streams.createStream({
        country: 'NL',
        name: 'NL Down',
        folder: 'nl_down',
        url: 'https://example.com/nl_down',
    });

    const analysisRouter = require('../routes/analysis');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = authenticated ? { userId: 1, username: 'admin' } : {};
        next();
    });
    app.use('/api/analysis', analysisRouter);

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function getJson(pathname) {
    return fetch(`${baseUrl}${pathname}`).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => undefined),
    }));
}

test('summary + gaps are 401 when anonymous', async () => {
    authenticated = false;
    assert.strictEqual((await getJson('/api/analysis/summary')).status, 401);
    assert.strictEqual(
        (await getJson('/api/analysis/gaps?folder=nl_one&start=2026-01-01&end=2026-01-01')).status,
        401
    );
    authenticated = true;
});

test('authenticated summary returns {per_stream, overall}', async () => {
    authenticated = true;
    const res = await getJson('/api/analysis/summary');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.per_stream));
    assert.ok(res.body.overall);
    assert.strictEqual(res.body.per_stream.length, 1);
    assert.strictEqual(res.body.per_stream[0].stream_folder, 'nl_one');
    assert.strictEqual(res.body.per_stream[0].recording_count, 2);
    assert.strictEqual(res.body.overall.storage_bytes, 3000);
    assert.strictEqual(res.body.overall.stream_count, 1);
});

test('gaps requires folder (400 {field:folder})', async () => {
    authenticated = true;
    const res = await getJson('/api/analysis/gaps?start=2026-01-01&end=2026-01-01');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'folder');
});

test('gaps rejects a bad date with 400 {field:start}', async () => {
    authenticated = true;
    const res = await getJson(
        '/api/analysis/gaps?folder=nl_one&start=not-a-date&end=2026-01-01'
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'start');
});

test('gaps rejects start > end with 400 {field:start}', async () => {
    authenticated = true;
    const res = await getJson(
        '/api/analysis/gaps?folder=nl_one&start=2026-01-02&end=2026-01-01'
    );
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'start');
});

test('gaps returns the documented shape on success', async () => {
    authenticated = true;
    const res = await getJson(
        '/api/analysis/gaps?folder=nl_one&start=2026-01-01&end=2026-01-01'
    );
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.folder, 'nl_one');
    assert.strictEqual(res.body.expected_count, 24); // one full day
    assert.strictEqual(res.body.present_count, 2); // seeded hours 00 + 01
    assert.strictEqual(res.body.missing.length, 22);
    assert.ok(Math.abs(res.body.coverage_ratio - 2 / 24) < 1e-9);
    // Each missing entry carries {date, hour}.
    assert.deepStrictEqual(
        Object.keys(res.body.missing[0]).sort(),
        ['date', 'hour']
    );
});

test('stream-health is 401 when anonymous', async () => {
    authenticated = false;
    assert.strictEqual(
        (await getJson('/api/analysis/stream-health')).status,
        401
    );
    authenticated = true;
});

test('stream-health rejects a non-integer windowHours (400 {field})', async () => {
    authenticated = true;
    const res = await getJson('/api/analysis/stream-health?windowHours=abc');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'windowHours');
});

test('stream-health rejects out-of-range windowHours (400 {field})', async () => {
    authenticated = true;
    const zero = await getJson('/api/analysis/stream-health?windowHours=0');
    assert.strictEqual(zero.status, 400);
    assert.strictEqual(zero.body.field, 'windowHours');
    const tooBig = await getJson('/api/analysis/stream-health?windowHours=999');
    assert.strictEqual(tooBig.status, 400);
    assert.strictEqual(tooBig.body.field, 'windowHours');
});

test('authenticated stream-health returns per-stream health + roll-up', async () => {
    authenticated = true;

    // Seed the last 24h of complete rows for nl_ok so it is healthy right now.
    // Done here (not in `before`) so the fixed-date summary/gaps assertions on
    // nl_one are not affected by these now-relative rows.
    const recordings = require('../services/recordings');
    const pad = (n) => String(n).padStart(2, '0');
    const localSlot = (d) => ({
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        hour: pad(d.getHours()),
    });
    const nowSeed = new Date();
    for (let i = 1; i <= 24; i += 1) {
        const slot = localSlot(new Date(nowSeed.getTime() - i * 3600 * 1000));
        recordings.upsertRecording(db, {
            stream_folder: 'nl_ok',
            date: slot.date,
            hour: slot.hour,
            file_path: `/audio/nl_ok/nl_ok-${slot.date}-${slot.hour}.mp3`,
            status: 'complete',
            duration_seconds: 3600,
            size_bytes: 1000,
            segment_count: 1,
        });
    }

    // nl_down: a single complete row far older than any window, so
    // listRecentByDate won't fetch it but latestCompleteByFolder will → down.
    recordings.upsertRecording(db, {
        stream_folder: 'nl_down',
        date: '2020-01-01',
        hour: '00',
        file_path: '/audio/nl_down/nl_down-2020-01-01-00.mp3',
        status: 'complete',
        duration_seconds: 3600,
        size_bytes: 1000,
        segment_count: 1,
    });

    const res = await getJson('/api/analysis/stream-health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.window_hours, 24);
    assert.ok(res.body.generated_slot && res.body.generated_slot.date);
    assert.ok(Array.isArray(res.body.streams));
    assert.strictEqual(res.body.streams.length, 3); // nl_ok + nl_never + nl_down

    const valid = new Set(['ok', 'degraded', 'down', 'never']);
    for (const s of res.body.streams) {
        assert.deepStrictEqual(
            Object.keys(s).sort(),
            [
                'consecutiveMissing',
                'expectedInWindow',
                'folder',
                'lastSuccessfulSlot',
                'name',
                'presentInWindow',
                'status',
            ]
        );
        assert.ok(valid.has(s.status), `bad status ${s.status}`);
    }

    const byFolder = Object.fromEntries(
        res.body.streams.map((s) => [s.folder, s])
    );
    assert.strictEqual(byFolder.nl_ok.status, 'ok');
    assert.strictEqual(byFolder.nl_never.status, 'never');
    // The long-stopped stream (only an out-of-window complete) must be `down`,
    // NOT `never` — proving the all-time last-complete signal flows through the
    // real route, not just the hand-injected pure-helper test.
    assert.strictEqual(byFolder.nl_down.status, 'down');
    assert.notStrictEqual(byFolder.nl_down.lastSuccessfulSlot, null);
    assert.deepStrictEqual(byFolder.nl_down.lastSuccessfulSlot, {
        date: '2020-01-01',
        hour: '00',
    });

    // Counts roll up; unhealthy_count == down + degraded + never (non-ok).
    assert.strictEqual(res.body.counts.total, 3);
    assert.strictEqual(res.body.counts.ok, 1);
    assert.strictEqual(res.body.counts.never, 1);
    assert.strictEqual(res.body.counts.down, 1);
    assert.strictEqual(res.body.unhealthy_count, 2);
});
