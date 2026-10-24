/**
 * Integration coverage for the /api/jobs router (design §6.1, AC-7): job-control
 * + scheduler-config + log_retention endpoints, all behind requireAuth. The
 * router + services are bound to a temp DB via the require.cache injection
 * pattern FEAT-001 established, then mounted in a minimal Express app whose
 * session middleware can be toggled authenticated/anonymous per request.
 *
 * Also covers the output-retention guarantee (AC-12): a running job survives a
 * prune even with >N newer terminal rows (both the pure rowsToPrune helper and
 * the real pruneJobOutput against the DB).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

const { applySchema } = require('../db/schema');
const { seedJobConfig } = require('../db/seed-jobconfig');

let tmpDir;
let db;
let jobs;
let server;
let baseUrl;

// Toggled by tests: when true the fake session carries a userId so requireAuth
// passes; when false the request is anonymous and must 401.
let authenticated = true;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-jobroutes-'));
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
    seedJobConfig(db);

    jobs = require('../services/jobs');
    const jobsRouter = require('../routes/jobs');

    const app = express();
    app.use(express.json());
    // Fake session middleware the tests can flip authenticated/anonymous.
    app.use((req, res, next) => {
        req.session = authenticated
            ? { userId: 1, username: 'admin' }
            : {};
        next();
    });
    app.use('/api/jobs', jobsRouter);

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

function reqJson(method, pathname, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    return fetch(`${baseUrl}${pathname}`, opts).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => undefined),
    }));
}

test('GET /api/jobs lists recent jobs for an authenticated user', async () => {
    authenticated = true;
    db.exec('DELETE FROM jobs');
    jobs.enqueueJob('cleaner', 'manual');
    const res = await reqJson('GET', '/api/jobs');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].type, 'cleaner');
});

test('GET /api/jobs rejects an out-of-range limit with 400 {field:limit}', async () => {
    authenticated = true;
    const res = await reqJson('GET', '/api/jobs?limit=0');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'limit');

    const res2 = await reqJson('GET', '/api/jobs?limit=201');
    assert.strictEqual(res2.status, 400);
    assert.strictEqual(res2.body.field, 'limit');
});

test('GET /api/jobs unauthenticated returns 401', async () => {
    authenticated = false;
    const res = await reqJson('GET', '/api/jobs');
    assert.strictEqual(res.status, 401);
    authenticated = true;
});

test('POST /api/jobs enqueues a manual job and returns the created row (201)', async () => {
    authenticated = true;
    db.exec('DELETE FROM jobs');
    const res = await reqJson('POST', '/api/jobs', { type: 'peakfilegenerator' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.type, 'peakfilegenerator');
    assert.strictEqual(res.body.trigger_source, 'manual');
    assert.strictEqual(res.body.status, 'pending');

    const count = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
    assert.strictEqual(count, 1, 'enqueue drove a jobs row');
});

test('POST /api/jobs rejects an unknown type with 400 {field:type}', async () => {
    authenticated = true;
    const res = await reqJson('POST', '/api/jobs', { type: 'bogus' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'type');
});

test('POST /api/jobs unauthenticated returns 401', async () => {
    authenticated = false;
    const res = await reqJson('POST', '/api/jobs', { type: 'cleaner' });
    assert.strictEqual(res.status, 401);
    authenticated = true;
});

test('GET /api/jobs/schedules lists schedule rows', async () => {
    authenticated = true;
    const res = await reqJson('GET', '/api/jobs/schedules');
    assert.strictEqual(res.status, 200);
    const types = res.body.map((s) => s.type).sort();
    assert.deepStrictEqual(types, ['cleaner', 'peakfilegenerator', 'reconcile']);
});

test('PUT /api/jobs/schedules/:type updates a known schedule', async () => {
    authenticated = true;
    const res = await reqJson('PUT', '/api/jobs/schedules/cleaner', {
        enabled: 1,
        frequency: 'daily',
        minute: 15,
        hour: 3,
        day_of_week: 0,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.frequency, 'daily');
    assert.strictEqual(res.body.hour, 3);
    assert.strictEqual(res.body.minute, 15);
});

test('PUT /api/jobs/schedules/:type 404s an unknown type', async () => {
    authenticated = true;
    const res = await reqJson('PUT', '/api/jobs/schedules/nope', {
        enabled: 1,
        frequency: 'hourly',
        minute: 0,
        hour: 0,
        day_of_week: 0,
    });
    assert.strictEqual(res.status, 404);
});

test('PUT /api/jobs/schedules/:type 400s an invalid field with {error,field}', async () => {
    authenticated = true;
    const res = await reqJson('PUT', '/api/jobs/schedules/cleaner', {
        enabled: 1,
        frequency: 'hourly',
        minute: 99, // out of range
        hour: 0,
        day_of_week: 0,
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.field, 'minute');
});

test('GET/PUT /api/jobs/config/log_retention round-trips and validates', async () => {
    authenticated = true;
    const put = await reqJson('PUT', '/api/jobs/config/log_retention', {
        hours: 48,
    });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(put.body.hours, 48);

    const get = await reqJson('GET', '/api/jobs/config/log_retention');
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.body.hours, 48);

    const bad = await reqJson('PUT', '/api/jobs/config/log_retention', {
        hours: 0,
    });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.field, 'hours');
});

test('rowsToPrune returns only the ids beyond the newest N', () => {
    assert.deepStrictEqual(jobs.rowsToPrune([5, 4, 3, 2, 1], 2), [3, 2, 1]);
    assert.deepStrictEqual(jobs.rowsToPrune([5, 4], 5), []);
    // A non-positive/invalid N keeps nothing (prunes all).
    assert.deepStrictEqual(jobs.rowsToPrune([3, 2, 1], 0), [3, 2, 1]);
});

test('pruneJobOutput: a running job survives a prune even with >N newer terminal rows (AC-12)', () => {
    db.exec('DELETE FROM jobs');

    // An old running job, created BEFORE a burst of newer terminal rows. With a
    // created_at ordering across all statuses it would be pushed out of the
    // newest-N window and pruned mid-run; the terminal-only filter prevents that.
    const running = jobs.enqueueJob('cleaner', 'manual');
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(
        running.id
    );

    // N+ newer terminal rows (N = 2 here).
    for (let i = 0; i < 5; i += 1) {
        const r = jobs.enqueueJob('cleaner', 'schedule');
        db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(r.id);
    }

    jobs.pruneJobOutput(2);

    const stillRunning = jobs.getJob(running.id);
    assert.ok(stillRunning, 'the running job must survive the prune');
    assert.strictEqual(stillRunning.status, 'running');

    const terminalCount = db
        .prepare(
            "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('done','failed','skipped')"
        )
        .get().n;
    assert.strictEqual(terminalCount, 2, 'only the newest N terminal rows kept');
});
