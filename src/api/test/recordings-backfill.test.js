/**
 * Backfill reconcile coverage (FEAT-001): reconcilePlan plans an insert only for
 * slots not already present, folds a .partN segment into segment_count + status
 * 'partial', and is idempotent on a second run over the same scanned set. The
 * planner now returns { inserts, removes, updates }; these assertions target
 * `inserts` — the only direction the startup backfill applies.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// recordings-backfill requires ../services/recordings, which requires ../db at
// module load (db/index.js opens a real DatabaseSync at /usr/src/app/data/app.db
// and throws when that path is absent, as in the test toolchain). Seed a temp DB
// into require.cache for '../db' BEFORE requiring the module under test, mirroring
// the injection pattern in recordings.test.js / jobs-schema.test.js. reconcilePlan
// itself is pure, but the module graph still pulls in the shared handle.
let tmpDir;
let db;
let reconcilePlan;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-backfill-'));
    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
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

    ({ reconcilePlan } = require('../services/recordings-backfill'));
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function scanned(folder, date, hour, part) {
    return {
        folder,
        date,
        hour,
        part,
        file_path: `/audio/${folder}/${folder}-${date}-${hour}${
            part === 1 ? '' : `.part${part}`
        }.mp3`,
    };
}

/** An existing DB row for the slot, derived like a prior reconcile would store it. */
function row(folder, date, hour, extra = {}) {
    return {
        stream_folder: folder,
        date,
        hour,
        status: 'complete',
        segment_count: 1,
        file_path: `/audio/${folder}/${folder}-${date}-${hour}.mp3`,
        ...extra,
    };
}

test('reconcilePlan plans inserts only for slots not already present', () => {
    const existing = [row('radio1', '2026-10-23', '09')];
    const files = [
        scanned('radio1', '2026-10-23', '09', 1), // already present -> skipped
        scanned('radio1', '2026-10-23', '10', 1), // new
        scanned('radio2', '2026-10-23', '00', 1), // new
    ];

    const plan = reconcilePlan(existing, files);
    assert.strictEqual(plan.inserts.length, 2);
    const keys = plan.inserts
        .map((p) => `${p.stream_folder}|${p.date}|${p.hour}`)
        .sort();
    assert.deepStrictEqual(keys, ['radio1|2026-10-23|10', 'radio2|2026-10-23|00']);
    for (const p of plan.inserts) {
        assert.strictEqual(p.status, 'complete');
        assert.strictEqual(p.segment_count, 1);
    }
});

test('reconcilePlan folds a .partN segment into segment_count + status partial', () => {
    const files = [
        scanned('radio1', '2026-10-23', '09', 1),
        scanned('radio1', '2026-10-23', '09', 2),
        scanned('radio1', '2026-10-23', '09', 3),
    ];
    const plan = reconcilePlan([], files);
    assert.strictEqual(plan.inserts.length, 1, 'all segments fold into one hour-slot');
    assert.strictEqual(plan.inserts[0].status, 'partial');
    assert.strictEqual(plan.inserts[0].segment_count, 3);
    // file_path points at the primary file for the slot.
    assert.strictEqual(
        plan.inserts[0].file_path,
        '/audio/radio1/radio1-2026-10-23-09.mp3'
    );
});

test('reconcilePlan with only a .partN (no primary) is still partial', () => {
    const files = [scanned('radio1', '2026-10-23', '09', 2)];
    const plan = reconcilePlan([], files);
    assert.strictEqual(plan.inserts.length, 1);
    assert.strictEqual(plan.inserts[0].status, 'partial');
    assert.strictEqual(plan.inserts[0].segment_count, 1);
    assert.strictEqual(
        plan.inserts[0].file_path,
        '/audio/radio1/radio1-2026-10-23-09.part2.mp3'
    );
});

test('reconcilePlan is idempotent: a second run over the same set inserts nothing', () => {
    const files = [
        scanned('radio1', '2026-10-23', '09', 1),
        scanned('radio1', '2026-10-23', '09', 2),
        scanned('radio2', '2026-10-23', '00', 1),
    ];

    const first = reconcilePlan([], files);
    assert.strictEqual(first.inserts.length, 2);

    // Feed the first run's produced inserts back as existing rows.
    const now = first.inserts.map((p) =>
        row(p.stream_folder, p.date, p.hour, {
            status: p.status,
            segment_count: p.segment_count,
            file_path: p.file_path,
        })
    );
    const second = reconcilePlan(now, files);
    assert.strictEqual(second.inserts.length, 0, 'nothing new to insert on a re-run');
    assert.strictEqual(second.updates.length, 0, 'matching metadata -> no updates');
    assert.strictEqual(second.removes.length, 0, 'every row still on disk -> no removes');
});
