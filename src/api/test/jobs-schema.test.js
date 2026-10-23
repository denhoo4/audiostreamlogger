const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');
const { seedJobConfig } = require('../db/seed-jobconfig');

// The services (jobs.js) `require('../db')`, which opens a fixed /usr/src/app
// path. For the temp-DB integration tests we populate Node's module cache with
// a temp DatabaseSync BEFORE requiring the service so it binds to our handle.
let tmpDir;
let db;
let jobs;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-jobs-'));
    const dbPath = path.join(tmpDir, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');

    // Inject the temp handle as the resolved '../db' module for services/jobs.js.
    const dbModulePath = require.resolve('../db');
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: db,
    };

    jobs = require('../services/jobs');
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('applySchema creates the jobs, schedules and app_config tables', () => {
    applySchema(db);
    const tables = db
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((r) => r.name);
    for (const t of ['jobs', 'schedules', 'app_config', 'streams', 'users']) {
        assert.ok(tables.includes(t), `expected table ${t}`);
    }

    const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((r) => r.name);
    assert.ok(indexes.includes('idx_jobs_status_created'));
    assert.ok(indexes.includes('idx_jobs_created'));

    // The jobs columns are present with the documented shape.
    const cols = db
        .prepare('PRAGMA table_info(jobs)')
        .all()
        .map((c) => c.name);
    assert.deepStrictEqual(cols, [
        'id',
        'type',
        'trigger_source',
        'status',
        'output',
        'created_at',
        'started_at',
        'finished_at',
    ]);
});

test('applySchema is idempotent (a second call does not throw or wipe data)', () => {
    db.prepare(
        "INSERT INTO jobs (type, trigger_source) VALUES ('cleaner', 'manual')"
    ).run();
    const before = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
    applySchema(db);
    const after = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
    assert.strictEqual(after, before);

    // Clean up so later tests start from a known jobs state.
    db.exec('DELETE FROM jobs');
});

test('seedJobConfig seeds the two schedules and three config scalars', () => {
    seedJobConfig(db);

    const cleaner = db
        .prepare('SELECT * FROM schedules WHERE type = ?')
        .get('cleaner');
    assert.strictEqual(cleaner.frequency, 'hourly');
    assert.strictEqual(cleaner.minute, 10);
    assert.strictEqual(cleaner.enabled, 1);

    const peak = db
        .prepare('SELECT * FROM schedules WHERE type = ?')
        .get('peakfilegenerator');
    assert.strictEqual(peak.frequency, 'hourly');
    assert.strictEqual(peak.minute, 5);
    assert.strictEqual(peak.enabled, 1);

    const cfg = (key) =>
        db.prepare('SELECT value FROM app_config WHERE key = ?').get(key).value;
    assert.strictEqual(cfg('log_retention'), '2');
    assert.strictEqual(cfg('recorder_minute'), '0');
    assert.strictEqual(cfg('output_retention_count'), '100');
});

test('seedJobConfig is idempotent: a second seed never duplicates or overwrites user changes', () => {
    // Simulate a user changing a seeded value.
    db.prepare('UPDATE schedules SET minute = ? WHERE type = ?').run(
        42,
        'cleaner'
    );
    db.prepare('UPDATE app_config SET value = ? WHERE key = ?').run(
        '5',
        'log_retention'
    );

    seedJobConfig(db);

    const scheduleCount = db
        .prepare('SELECT COUNT(*) AS n FROM schedules')
        .get().n;
    assert.strictEqual(scheduleCount, 2, 'no duplicate schedule rows');

    const cleaner = db
        .prepare('SELECT minute FROM schedules WHERE type = ?')
        .get('cleaner');
    assert.strictEqual(cleaner.minute, 42, 'user-changed minute preserved');

    const retention = db
        .prepare('SELECT value FROM app_config WHERE key = ?')
        .get('log_retention').value;
    assert.strictEqual(retention, '5', 'user-changed config preserved');
});

test('enqueueJob inserts a pending row and returns it', () => {
    const row = jobs.enqueueJob('cleaner', 'manual');
    assert.strictEqual(row.type, 'cleaner');
    assert.strictEqual(row.trigger_source, 'manual');
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(row.output, '');
    assert.ok(row.id > 0);
    assert.ok(row.created_at);
});

test('listRecentJobs returns newest-first capped at limit', () => {
    db.exec('DELETE FROM jobs');
    const a = jobs.enqueueJob('cleaner', 'manual');
    const b = jobs.enqueueJob('peakfilegenerator', 'schedule');
    const c = jobs.enqueueJob('cleaner', 'schedule');

    const recent = jobs.listRecentJobs(2);
    assert.strictEqual(recent.length, 2);
    assert.strictEqual(recent[0].id, c.id);
    assert.strictEqual(recent[1].id, b.id);

    assert.strictEqual(jobs.getJob(a.id).id, a.id);
});

test('pruneJobOutput deletes only terminal rows beyond the newest N and never a pending/running job', () => {
    db.exec('DELETE FROM jobs');

    // Two old terminal rows, one running, one pending — all created before the
    // newest terminal rows so an all-status ordering would push the live rows out.
    const oldDone = jobs.enqueueJob('cleaner', 'schedule');
    const oldFailed = jobs.enqueueJob('cleaner', 'schedule');
    const running = jobs.enqueueJob('cleaner', 'manual');
    const pending = jobs.enqueueJob('cleaner', 'manual');
    db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(oldDone.id);
    db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(
        oldFailed.id
    );
    db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(
        running.id
    );
    // pending stays pending

    // A newer terminal row to be kept.
    const newDone = jobs.enqueueJob('cleaner', 'schedule');
    db.prepare("UPDATE jobs SET status = 'done' WHERE id = ?").run(newDone.id);

    // Keep only the newest 1 terminal row -> the two old terminal rows prune,
    // the running + pending rows survive untouched.
    jobs.pruneJobOutput(1);

    const ids = db
        .prepare('SELECT id FROM jobs ORDER BY id')
        .all()
        .map((r) => r.id);
    assert.ok(ids.includes(running.id), 'running job must survive');
    assert.ok(ids.includes(pending.id), 'pending job must survive');
    assert.ok(ids.includes(newDone.id), 'newest terminal row must survive');
    assert.ok(!ids.includes(oldDone.id), 'old terminal row pruned');
    assert.ok(!ids.includes(oldFailed.id), 'old terminal row pruned');
});
