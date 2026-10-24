/**
 * Stream-folder lifecycle service coverage — TODO items 25 (DELETE) + 26
 * (RENAME). Drives the REAL service logic (services/stream-lifecycle.js) against
 * a temp SQLite handle (injected) and a THROWAWAY temp audio dir pointed at by
 * process.env.AUDIO_DIR — NEVER the production ./audio. The real node:fs is used
 * so the move/rm actually happen on disk; a crash is simulated by injecting an
 * fs whose one op throws.
 *
 * What is proven here (the task's HARD requirements):
 *   - AUDIO_DIR base-dir identity: the lifecycle base dir == the worker's
 *     paths.js expression, so a rebuilt file_path matches the reconcile scan.
 *   - isContainedPath escape rejection (an op can never leave the base dir).
 *   - DELETE removes recordings rows + the streams row (ROW-FIRST ordering) and
 *     rm's the folder; the advisory impact reports file/byte counts.
 *   - The concrete current-Amsterdam-slot live-recorder 409 guard: a stream with
 *     ONLY historical rows is NOT blocked (proves the tautology is fixed); a
 *     stream with a current-slot status='recording' row IS blocked.
 *   - RENAME validates (allowlist + not-exists + differs), moves files, and
 *     rebuilds each row's file_path STAMP-ANCHORED — including a NUMERIC folder
 *     name (100nl -> z100) proving the date stamp is not corrupted.
 *   - After a rename disk+DB agree: the reconcile planner is a TRUE no-op.
 *   - Crash-recovery: a crash mid-delete and mid-rename leaves recoverable /
 *     non-corrupting partial state.
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');
const { amsterdamSlot } = require('../lib/amsterdam-slot');
const { parseRecordingFilename } = require('../lib/recording-name');
const { reconcilePlan } = require('../services/reconcile-planner');
const { audioBaseDir } = require('../lib/audio-dir');

let rootTmp; // throwaway root; AUDIO_DIR points at <rootTmp>/audio
let audioDir;
let db;
let lifecycle;

before(() => {
    rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-lifecycle-'));
    audioDir = path.join(rootTmp, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    // Point the lifecycle base dir at the THROWAWAY temp dir (never ./audio).
    process.env.AUDIO_DIR = audioDir;

    const dbPath = path.join(rootTmp, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');

    // Inject the temp handle for the service's module-level require('../db') so
    // loading stream-lifecycle does not try to open the production app.db.
    const dbModulePath = require.resolve('../db');
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: db,
    };

    applySchema(db);

    lifecycle = require('../services/stream-lifecycle');
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(rootTmp, { recursive: true, force: true });
    delete process.env.AUDIO_DIR;
});

beforeEach(() => {
    db.exec('DELETE FROM streams');
    db.exec('DELETE FROM recordings');
    // Wipe the audio dir between tests.
    for (const entry of fs.readdirSync(audioDir)) {
        fs.rmSync(path.join(audioDir, entry), { recursive: true, force: true });
    }
});

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function insertStream(folder, name = folder) {
    const r = db
        .prepare(
            "INSERT INTO streams (country, name, folder, url, codec) VALUES ('NL', ?, ?, 'https://e/x', 'mp3')"
        )
        .run(name, folder);
    return Number(r.lastInsertRowid);
}

function insertRecordingRow(folder, date, hour, status, { part = 1, ext = 'mp3' } = {}) {
    const partSuffix = part > 1 ? `.part${part}` : '';
    const name = `${folder}-${date}-${hour}${partSuffix}.${ext}`;
    const file_path = path.join(audioDir, folder, name);
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES (?, ?, ?, ?, ?, 1)`
    ).run(folder, date, hour, file_path, status);
    return file_path;
}

/** Write a recording file + its .json peak sibling into audioDir/<folder>/. */
function writeRecordingFile(folder, date, hour, { part = 1, ext = 'mp3', bytes = 10 } = {}) {
    const dir = path.join(audioDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const partSuffix = part > 1 ? `.part${part}` : '';
    const base = `${folder}-${date}-${hour}`;
    fs.writeFileSync(path.join(dir, `${base}${partSuffix}.${ext}`), Buffer.alloc(bytes, 1));
    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ data: [0] }));
}

/** Scan a folder the SAME way the worker reconcile does, for the no-op check. */
function scanFolder(folder) {
    const dir = path.join(audioDir, folder);
    const scanned = [];
    for (const name of fs.readdirSync(dir)) {
        const parsed = parseRecordingFilename(name);
        if (!parsed) continue; // skips .json peak siblings
        scanned.push({
            folder: parsed.folder,
            date: parsed.date,
            hour: parsed.hour,
            part: parsed.part,
            file_path: path.join(dir, name),
        });
    }
    return scanned;
}

/** A slot that is DEFINITELY not the current Amsterdam slot (historical). */
function historicalSlot() {
    return { date: '2020-01-01', hour: '05' };
}

/* ------------------------------------------------------------------ *
 * base-dir identity + containment
 * ------------------------------------------------------------------ */

test('AUDIO_DIR base-dir identity: lifecycle base == worker paths.js expression', () => {
    // The worker's expression, verbatim.
    const workerExpr = process.env.AUDIO_DIR || '/usr/src/app/audio';
    assert.strictEqual(audioBaseDir(), workerExpr);
    assert.strictEqual(audioBaseDir(), audioDir);
});

test('safeFolderPath rejects an escaping folder (containment guard)', () => {
    assert.throws(
        () => lifecycle.safeFolderPath('../escape'),
        /unsafe folder/
    );
    assert.throws(
        () => lifecycle.safeFolderPath('/abs/path'),
        /unsafe folder/
    );
    assert.throws(
        () => lifecycle.safeFolderPath('BAD CAPS'),
        /unsafe folder/
    );
    // A valid folder resolves inside the base dir.
    assert.strictEqual(
        lifecycle.safeFolderPath('radio1'),
        path.join(audioDir, 'radio1')
    );
});

/* ------------------------------------------------------------------ *
 * deletion impact (advisory)
 * ------------------------------------------------------------------ */

test('deletionImpact reports file count + total bytes; zeros for a missing folder', () => {
    writeRecordingFile('radio1', '2026-10-23', '09', { bytes: 100 });
    writeRecordingFile('radio1', '2026-10-23', '10', { bytes: 50 });
    const impact = lifecycle.deletionImpact('radio1');
    // 2 recordings + 2 .json siblings = 4 files; bytes = 150 recordings + json.
    assert.strictEqual(impact.folder, 'radio1');
    assert.strictEqual(impact.fileCount, 4);
    assert.ok(impact.totalBytes >= 150);

    const none = lifecycle.deletionImpact('ghost');
    assert.deepStrictEqual(none, { folder: 'ghost', fileCount: 0, totalBytes: 0 });
});

/* ------------------------------------------------------------------ *
 * DELETE (item 25)
 * ------------------------------------------------------------------ */

test('DELETE removes recordings rows + streams row (row-first) and rm\'s the folder', () => {
    const id = insertStream('radio1');
    insertRecordingRow('radio1', '2026-10-23', '09', 'complete');
    insertRecordingRow('radio1', '2026-10-23', '10', 'complete');
    writeRecordingFile('radio1', '2026-10-23', '09');
    writeRecordingFile('radio1', '2026-10-23', '10');

    const res = lifecycle.deleteStreamWithFolder(id, { db });
    assert.strictEqual(res.removed, true);
    assert.strictEqual(res.fsError, null);

    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM streams').get().c, 0);
    assert.strictEqual(
        db.prepare("SELECT COUNT(*) c FROM recordings WHERE stream_folder='radio1'").get().c,
        0
    );
    assert.strictEqual(fs.existsSync(path.join(audioDir, 'radio1')), false);
});

test('DELETE of an unknown id returns null', () => {
    assert.strictEqual(lifecycle.deleteStreamWithFolder(999999, { db }), null);
});

test('DELETE is NOT blocked by a purely HISTORICAL recording row (tautology fixed)', () => {
    const id = insertStream('radio1');
    // Only historical rows (old slot) — even a 'recording'-status one in the past
    // must NOT be treated as recording right now.
    const hist = historicalSlot();
    insertRecordingRow('radio1', hist.date, hist.hour, 'recording');
    insertRecordingRow('radio1', '2026-10-20', '12', 'complete');

    const res = lifecycle.deleteStreamWithFolder(id, { db });
    assert.strictEqual(res.removed, true);
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM streams').get().c, 0);
});

test('DELETE IS blocked (409) when a current-slot row has status=recording', () => {
    const id = insertStream('radio1');
    const now = new Date();
    const slot = amsterdamSlot(now);
    insertRecordingRow('radio1', slot.date, slot.hour, 'recording');

    assert.throws(
        () => lifecycle.deleteStreamWithFolder(id, { db, now }),
        lifecycle.StreamRecordingNowError
    );
    // Nothing was removed.
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM streams').get().c, 1);
    assert.strictEqual(
        db.prepare("SELECT COUNT(*) c FROM recordings WHERE stream_folder='radio1'").get().c,
        1
    );
});

test('DELETE NOT blocked when current-slot row is complete (not recording)', () => {
    const id = insertStream('radio1');
    const now = new Date();
    const slot = amsterdamSlot(now);
    insertRecordingRow('radio1', slot.date, slot.hour, 'complete');

    const res = lifecycle.deleteStreamWithFolder(id, { db, now });
    assert.strictEqual(res.removed, true);
});

/* ------------------------------------------------------------------ *
 * RENAME (item 26)
 * ------------------------------------------------------------------ */

test('RENAME validates: rejects a bad allowlist, a non-differing, and an existing target', () => {
    insertStream('radio1');
    writeRecordingFile('radio1', '2026-10-23', '09');

    assert.throws(
        () => lifecycle.renameStreamFolder('radio1', 'BAD CAPS', { db }),
        lifecycle.RenameValidationError
    );
    assert.throws(
        () => lifecycle.renameStreamFolder('radio1', 'radio1', { db }),
        lifecycle.RenameValidationError
    );
    // Target already exists on disk.
    writeRecordingFile('radio2', '2026-10-23', '09');
    assert.throws(
        () => lifecycle.renameStreamFolder('radio1', 'radio2', { db }),
        lifecycle.RenameValidationError
    );
});

test('RENAME moves files + rebuilds rows; current-slot recording is 409-blocked', () => {
    insertStream('radio1');
    const now = new Date();
    const slot = amsterdamSlot(now);
    insertRecordingRow('radio1', slot.date, slot.hour, 'recording');
    writeRecordingFile('radio1', slot.date, slot.hour);

    assert.throws(
        () => lifecycle.renameStreamFolder('radio1', 'radio_new', { db, now }),
        lifecycle.StreamRecordingNowError
    );
    // Untouched.
    assert.ok(fs.existsSync(path.join(audioDir, 'radio1')));
    assert.strictEqual(fs.existsSync(path.join(audioDir, 'radio_new')), false);
});

test('RENAME (alpha folder): files move, rows re-point, .json peaks travel', () => {
    insertStream('radio1');
    insertRecordingRow('radio1', '2026-10-23', '09', 'complete');
    insertRecordingRow('radio1', '2026-10-23', '10', 'complete');
    writeRecordingFile('radio1', '2026-10-23', '09');
    writeRecordingFile('radio1', '2026-10-23', '10');

    const res = lifecycle.renameStreamFolder('radio1', 'radio_new', { db });
    assert.strictEqual(res.rowsRepointed, 2);

    assert.strictEqual(fs.existsSync(path.join(audioDir, 'radio1')), false);
    assert.ok(fs.existsSync(path.join(audioDir, 'radio_new', 'radio_new-2026-10-23-09.mp3')));
    assert.ok(fs.existsSync(path.join(audioDir, 'radio_new', 'radio_new-2026-10-23-09.json')));

    const rows = db
        .prepare("SELECT stream_folder, file_path FROM recordings ORDER BY hour")
        .all();
    for (const row of rows) {
        assert.strictEqual(row.stream_folder, 'radio_new');
        assert.ok(row.file_path.startsWith(path.join(audioDir, 'radio_new') + path.sep));
        assert.ok(row.file_path.includes('radio_new-2026-10-23-'));
    }
});

test('RENAME of a NUMERIC folder (100nl -> z100) keeps the date stamp intact (no blind REPLACE)', () => {
    insertStream('100nl');
    // Numeric folder + a date whose digits a blind REPLACE('100','z100') would clobber.
    insertRecordingRow('100nl', '2026-01-09', '10', 'complete');
    writeRecordingFile('100nl', '2026-01-09', '10');

    lifecycle.renameStreamFolder('100nl', 'z100', { db });

    const row = db.prepare('SELECT stream_folder, file_path FROM recordings').get();
    assert.strictEqual(row.stream_folder, 'z100');
    // The stamp YYYY-MM-DD-HH is UNCHANGED; only the folder prefix changed.
    const expected = path.join(audioDir, 'z100', 'z100-2026-01-09-10.mp3');
    assert.strictEqual(row.file_path, expected);
    // The date stamp survived intact — a blind REPLACE('100','z100') would have
    // rewritten the '10' in '-10.mp3' / any '100' in the stamp; it did not.
    assert.ok(row.file_path.includes('2026-01-09-10'));
    assert.ok(fs.existsSync(expected));
});

test('RENAME then reconcile planner is a TRUE no-op (disk+DB agree)', () => {
    insertStream('100nl');
    insertRecordingRow('100nl', '2026-01-09', '10', 'complete');
    insertRecordingRow('100nl', '2026-01-09', '11', 'complete');
    writeRecordingFile('100nl', '2026-01-09', '10');
    writeRecordingFile('100nl', '2026-01-09', '11');

    lifecycle.renameStreamFolder('100nl', 'z100', { db });

    // Scan the new folder exactly like the worker reconcile does, load the rows,
    // and run the SHARED planner. currentStamp is a far-off slot so nothing is
    // guarded — the no-op must come from true disk/DB agreement, not a guard.
    const scanned = scanFolder('z100');
    const existingRows = db
        .prepare(
            'SELECT stream_folder, date, hour, status, segment_count, file_path FROM recordings'
        )
        .all();
    const plan = reconcilePlan(existingRows, scanned, { currentStamp: '2000-01-01-00' });

    assert.deepStrictEqual(plan.inserts, []);
    assert.deepStrictEqual(plan.updates, []);
    assert.deepStrictEqual(plan.removes, []);
});

/* ------------------------------------------------------------------ *
 * crash-recovery
 * ------------------------------------------------------------------ */

test('crash mid-DELETE (fs.rm throws AFTER rows removed) leaves stream logically gone + orphan dir recoverable', () => {
    const id = insertStream('radio1');
    insertRecordingRow('radio1', '2026-10-23', '09', 'complete');
    writeRecordingFile('radio1', '2026-10-23', '09');

    // Inject an fs whose rmSync throws — simulates a crash during the rm step.
    const crashingFs = {
        rmSync: () => {
            throw new Error('simulated crash during rm');
        },
    };
    const res = lifecycle.deleteStreamWithFolder(id, { db, fs: crashingFs });

    // Rows gone (row-first ordering ran before the fs step).
    assert.strictEqual(res.removed, true);
    assert.ok(res.fsError);
    assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM streams').get().c, 0);
    assert.strictEqual(
        db.prepare("SELECT COUNT(*) c FROM recordings WHERE stream_folder='radio1'").get().c,
        0
    );
    // The dir is an orphan on disk — recoverable: reconcile sees rows gone, so a
    // retry rm cleans it; crucially the stream can NEVER be resurrected.
    assert.ok(fs.existsSync(path.join(audioDir, 'radio1')));
});

test('crash mid-RENAME (row UPDATE throws AFTER move) does not corrupt: rows roll back, files are on the new side (reconcile can repair)', () => {
    insertStream('radio1');
    insertRecordingRow('radio1', '2026-10-23', '09', 'complete');
    writeRecordingFile('radio1', '2026-10-23', '09');

    // Inject a db whose UPDATE throws mid-transaction; the real fs still moves the
    // dir first. The row-rebuild transaction must ROLL BACK.
    const realExec = db.exec.bind(db);
    const crashingDb = {
        exec: (sql) => realExec(sql),
        prepare: (sql) => {
            const stmt = db.prepare(sql);
            if (/UPDATE recordings SET stream_folder/.test(sql)) {
                return {
                    run: () => {
                        throw new Error('simulated crash during row UPDATE');
                    },
                };
            }
            return stmt;
        },
    };

    assert.throws(
        () => lifecycle.renameStreamFolder('radio1', 'radio_new', { db: crashingDb }),
        /simulated crash/
    );

    // The dir DID move (fs step ran first); the rows rolled back to the old
    // folder. A follow-up reconcile reconciles the two sides; no row is corrupt.
    assert.ok(fs.existsSync(path.join(audioDir, 'radio_new')));
    assert.strictEqual(fs.existsSync(path.join(audioDir, 'radio1')), false);
    const row = db.prepare('SELECT stream_folder FROM recordings').get();
    assert.strictEqual(row.stream_folder, 'radio1'); // rolled back
});
