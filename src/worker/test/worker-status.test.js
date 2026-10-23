const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { writeWorkerStatus } = require('../worker');

// writeWorkerStatus UPSERTs the three informational app_config rows over the
// worker's RW handle. Exercise it against a temp DB that mirrors the api's
// app_config table (key PK, value TEXT) so the ON CONFLICT upsert path is real.
let tmpDir;
let db;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-worker-status-'));
    const dbPath = path.join(tmpDir, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(
        'CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
    );
});

after(() => {
    try {
        db.close();
    } catch {
        // already closed
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readConfig(key) {
    const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
    return row ? row.value : undefined;
}

test('writeWorkerStatus inserts status + heartbeat + current job id', () => {
    writeWorkerStatus(db, { status: 'running', currentJobId: 42 });

    assert.strictEqual(readConfig('worker_status'), 'running');
    assert.strictEqual(readConfig('worker_current_job_id'), '42');
    const hb = readConfig('worker_last_heartbeat');
    assert.ok(hb && !Number.isNaN(Date.parse(hb)), 'heartbeat is an ISO timestamp');
});

test('writeWorkerStatus upserts idempotently (no duplicate-key throw)', () => {
    writeWorkerStatus(db, { status: 'running', currentJobId: 42 });
    // A second call for the same keys must UPDATE in place, not throw.
    writeWorkerStatus(db, { status: 'idle', currentJobId: null });

    assert.strictEqual(readConfig('worker_status'), 'idle');
    // currentJobId null is stored as the empty string.
    assert.strictEqual(readConfig('worker_current_job_id'), '');

    const count = db
        .prepare("SELECT COUNT(*) AS n FROM app_config WHERE key = 'worker_status'")
        .get().n;
    assert.strictEqual(count, 1);
});

test('writeWorkerStatus rides out a transient SQLITE_BUSY via withBusyRetry', () => {
    // Fake handle whose first prepare().run() throws SQLITE_BUSY once, then
    // succeeds — proving the status write goes through withBusyRetry rather than
    // propagating the busy error.
    let busyThrown = false;
    const fakeDb = {
        prepare() {
            return {
                run(..._args) {
                    if (!busyThrown) {
                        busyThrown = true;
                        const err = new Error('database is locked: SQLITE_BUSY');
                        throw err;
                    }
                    return { changes: 1 };
                },
            };
        },
    };

    // Must not throw; the busy attempt is retried and then succeeds.
    assert.doesNotThrow(() =>
        writeWorkerStatus(fakeDb, { status: 'running', currentJobId: 7 })
    );
    assert.strictEqual(busyThrown, true);
});

test('writeWorkerStatus never throws on a failing write (best-effort)', () => {
    const throwingDb = {
        prepare() {
            return {
                run() {
                    throw new Error('disk I/O error');
                },
            };
        },
    };
    // A non-busy failure is swallowed (logged) so the worker never crashes.
    assert.doesNotThrow(() =>
        writeWorkerStatus(throwingDb, { status: 'idle', currentJobId: null })
    );
});
