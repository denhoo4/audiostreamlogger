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
    // nl_now gets a `recording` row at the Amsterdam-local CURRENT hour so it
    // reads recordingNow=true; nl_idle has no current-slot row so it reads
    // recordingNow=false; nl_utc models the timezone regression (see the
    // stream-health test below). These use their OWN folders so the fixed-date
    // summary/gaps assertions on nl_one stay exact.
    const streams = require('../services/streams');
    streams.createStream({
        country: 'NL',
        name: 'NL Now',
        folder: 'nl_now',
        url: 'https://example.com/nl_now',
    });
    streams.createStream({
        country: 'NL',
        name: 'NL Idle',
        folder: 'nl_idle',
        url: 'https://example.com/nl_idle',
    });
    // nl_utc: its ONLY row is at the UTC current hour. When Amsterdam ≠ UTC
    // (which it always is — CET +1 / CEST +2) that is NOT the Amsterdam current
    // slot, so recordingNow must be false. Under the OLD UTC/getHours() logic it
    // would wrongly read true — this is the timezone regression guard.
    streams.createStream({
        country: 'NL',
        name: 'NL Utc',
        folder: 'nl_utc',
        url: 'https://example.com/nl_utc',
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

test('authenticated stream-health returns the two-signal shape + roll-up', async () => {
    authenticated = true;

    // Seed rows relative to "now" so the route (which reads its own clock)
    // classifies them. Done here (not in `before`) so the fixed-date
    // summary/gaps assertions on nl_one are not affected by these rows. The
    // route computes the current slot in EUROPE/AMSTERDAM via the SAME
    // amsterdamSlot helper, so the test seeds against that helper (NOT the
    // process-local clock) to be timezone-robust on any CI runner.
    const recordings = require('../services/recordings');
    const { amsterdamSlot } = require('../lib/amsterdam-slot');
    const now = new Date();
    const amsNow = amsterdamSlot(now);

    // nl_now: a `recording` row at the Amsterdam CURRENT slot → recordingNow true.
    // Also seed its past 24h complete so last24h is "complete".
    recordings.upsertRecording(db, {
        stream_folder: 'nl_now',
        date: amsNow.date,
        hour: amsNow.hour,
        file_path: `/audio/nl_now/nl_now-${amsNow.date}-${amsNow.hour}.mp3`,
        status: 'recording',
        duration_seconds: null,
        size_bytes: null,
        segment_count: 1,
    });
    for (let i = 1; i <= 24; i += 1) {
        const slot = amsterdamSlot(new Date(now.getTime() - i * 3600 * 1000));
        recordings.upsertRecording(db, {
            stream_folder: 'nl_now',
            date: slot.date,
            hour: slot.hour,
            file_path: `/audio/nl_now/nl_now-${slot.date}-${slot.hour}.mp3`,
            status: 'complete',
            duration_seconds: 3600,
            size_bytes: 1000,
            segment_count: 1,
        });
    }

    const res = await getJson('/api/analysis/stream-health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.window_hours, 24);
    assert.ok(res.body.generated_slot && res.body.generated_slot.date);
    assert.ok(Array.isArray(res.body.streams));
    assert.strictEqual(res.body.streams.length, 3); // nl_now + nl_idle + nl_utc

    for (const s of res.body.streams) {
        assert.deepStrictEqual(Object.keys(s).sort(), [
            'folder',
            'last24h',
            'lastSlotStatus',
            'name',
            'recordingNow',
        ]);
        assert.strictEqual(typeof s.recordingNow, 'boolean');
        assert.strictEqual(typeof s.last24h.complete, 'boolean');
        assert.strictEqual(typeof s.last24h.gapCount, 'number');
        assert.ok(Array.isArray(s.last24h.gaps));
    }

    const byFolder = Object.fromEntries(
        res.body.streams.map((s) => [s.folder, s])
    );
    // nl_now has a recording row at the Amsterdam current slot → green check.
    assert.strictEqual(byFolder.nl_now.recordingNow, true);
    assert.strictEqual(byFolder.nl_now.last24h.complete, true);
    // nl_idle has no rows at all → not recording, and every past slot is a gap.
    assert.strictEqual(byFolder.nl_idle.recordingNow, false);
    assert.strictEqual(byFolder.nl_idle.last24h.complete, false);

    // Counts roll up to {total, recordingNow, notRecording}.
    assert.strictEqual(res.body.counts.total, 3);
    assert.strictEqual(res.body.counts.recordingNow, 1); // only nl_now
    assert.strictEqual(res.body.counts.notRecording, 2); // nl_idle + nl_utc
    assert.strictEqual(res.body.unhealthy_count, undefined);
});

test('stream-health computes the current slot in Amsterdam time, not UTC (regression)', async () => {
    authenticated = true;

    const recordings = require('../services/recordings');
    const { amsterdamSlot } = require('../lib/amsterdam-slot');
    const now = new Date();
    const amsNow = amsterdamSlot(now);

    // The UTC current slot. Amsterdam is always ahead of UTC (CET +1 / CEST +2),
    // so the UTC hour is a DIFFERENT, earlier slot than the Amsterdam hour.
    const pad = (n) => String(n).padStart(2, '0');
    const utcSlot = {
        date: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(
            now.getUTCDate()
        )}`,
        hour: pad(now.getUTCHours()),
    };

    // Only seed nl_utc if the UTC slot really differs from the Amsterdam slot
    // (it always does given the offset, but guard defensively). Its only row is
    // a `recording` row at the UTC current hour.
    assert.notDeepStrictEqual(
        utcSlot,
        amsNow,
        'Amsterdam and UTC current slots must differ for this regression guard'
    );
    recordings.upsertRecording(db, {
        stream_folder: 'nl_utc',
        date: utcSlot.date,
        hour: utcSlot.hour,
        file_path: `/audio/nl_utc/nl_utc-${utcSlot.date}-${utcSlot.hour}.mp3`,
        status: 'recording',
        duration_seconds: null,
        size_bytes: null,
        segment_count: 1,
    });

    const res = await getJson('/api/analysis/stream-health');
    assert.strictEqual(res.status, 200);
    // generated_slot must be the AMSTERDAM slot, not the UTC slot.
    assert.deepStrictEqual(res.body.generated_slot, amsNow);

    const byFolder = Object.fromEntries(
        res.body.streams.map((s) => [s.folder, s])
    );
    // The stream whose only row is at the UTC hour is NOT recording the
    // Amsterdam current hour → recordingNow false. Under the OLD UTC/getHours()
    // logic this would have been true: that is the bug this test guards.
    assert.strictEqual(byFolder.nl_utc.recordingNow, false);
});
