/**
 * Recordings service coverage (FEAT-001): upsertRecording insert-then-update
 * idempotency on the UNIQUE key (against a temp DB via the require.cache
 * injection pattern), the pure analysis helpers (expectedHourSlots / missingSlots
 * / aggregateByStream), and the pure filename parser (primary + .partN + null).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');
const { parseRecordingFilename } = require('../lib/recording-name');

let tmpDir;
let db;
let recordings;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-rec-'));
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
    recordings = require('../services/recordings');
});

after(() => {
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('upsertRecording inserts then updates on the UNIQUE (folder,date,hour) key', () => {
    db.exec('DELETE FROM recordings');

    recordings.upsertRecording(db, {
        stream_folder: 'radio1',
        date: '2026-10-23',
        hour: '09',
        file_path: '/audio/radio1/radio1-2026-10-23-09.mp3',
        status: 'complete',
        duration_seconds: 3600,
        size_bytes: 1000,
        segment_count: 1,
    });

    let rows = db.prepare('SELECT * FROM recordings').all();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'complete');
    assert.strictEqual(rows[0].size_bytes, 1000);
    assert.strictEqual(rows[0].segment_count, 1);

    // Second call on the same key updates in place, not a duplicate insert.
    recordings.upsertRecording(db, {
        stream_folder: 'radio1',
        date: '2026-10-23',
        hour: '09',
        file_path: '/audio/radio1/radio1-2026-10-23-09.mp3',
        status: 'partial',
        duration_seconds: 3500,
        size_bytes: 2000,
        segment_count: 2,
    });

    rows = db.prepare('SELECT * FROM recordings').all();
    assert.strictEqual(rows.length, 1, 'no duplicate row on the UNIQUE key');
    assert.strictEqual(rows[0].status, 'partial');
    assert.strictEqual(rows[0].size_bytes, 2000);
    assert.strictEqual(rows[0].duration_seconds, 3500);
    assert.strictEqual(rows[0].segment_count, 2);
});

test('upsertRecording accepts null duration/size and defaults segment_count', () => {
    db.exec('DELETE FROM recordings');
    recordings.upsertRecording(db, {
        stream_folder: 'radio2',
        date: '2026-10-23',
        hour: '00',
        file_path: '/audio/radio2/radio2-2026-10-23-00.mp3',
        status: 'recording',
    });
    const row = db.prepare('SELECT * FROM recordings').get();
    assert.strictEqual(row.duration_seconds, null);
    assert.strictEqual(row.size_bytes, null);
    assert.strictEqual(row.segment_count, 1);
});

test('expectedHourSlots yields 24 slots per day across an inclusive range', () => {
    const single = recordings.expectedHourSlots('2026-10-23', '2026-10-23');
    assert.strictEqual(single.length, 24);
    assert.deepStrictEqual(single[0], { date: '2026-10-23', hour: '00' });
    assert.deepStrictEqual(single[23], { date: '2026-10-23', hour: '23' });

    // Cross-day range: two days => 48 slots, first slot of day 2 at index 24.
    const cross = recordings.expectedHourSlots('2026-10-23', '2026-10-24');
    assert.strictEqual(cross.length, 48);
    assert.deepStrictEqual(cross[24], { date: '2026-10-24', hour: '00' });

    // end before start yields nothing.
    assert.deepStrictEqual(
        recordings.expectedHourSlots('2026-10-24', '2026-10-23'),
        []
    );
});

test('missingSlots returns expected slots with no matching present row', () => {
    const expected = recordings.expectedHourSlots('2026-10-23', '2026-10-23');
    const present = [
        { date: '2026-10-23', hour: '00' },
        { date: '2026-10-23', hour: '09' },
    ];
    const missing = recordings.missingSlots(expected, present);
    assert.strictEqual(missing.length, 22);
    assert.ok(!missing.some((s) => s.hour === '00'));
    assert.ok(!missing.some((s) => s.hour === '09'));
    assert.ok(missing.some((s) => s.hour === '10'));
});

test('aggregateByStream folds rows per stream incl. a partial row', () => {
    const rows = [
        {
            stream_folder: 'radio1',
            date: '2026-10-23',
            hour: '09',
            status: 'complete',
            duration_seconds: 3600,
            size_bytes: 1000,
            segment_count: 1,
        },
        {
            stream_folder: 'radio1',
            date: '2026-10-23',
            hour: '10',
            status: 'partial',
            duration_seconds: null, // unknown duration — excluded from the mean
            size_bytes: 500,
            segment_count: 2,
        },
        {
            stream_folder: 'radio2',
            date: '2026-10-22',
            hour: '23',
            status: 'complete',
            duration_seconds: 1800,
            size_bytes: 2000,
            segment_count: 1,
        },
    ];

    const agg = recordings.aggregateByStream(rows);
    const r1 = agg.find((a) => a.stream_folder === 'radio1');
    const r2 = agg.find((a) => a.stream_folder === 'radio2');

    assert.strictEqual(r1.total_hours, 2);
    assert.strictEqual(r1.recording_count, 2);
    assert.strictEqual(r1.storage_bytes, 1500);
    assert.strictEqual(r1.avg_duration_seconds, 3600); // only the one known duration
    assert.strictEqual(r1.earliest, '2026-10-23-09');
    assert.strictEqual(r1.latest, '2026-10-23-10');

    assert.strictEqual(r2.total_hours, 1);
    assert.strictEqual(r2.avg_duration_seconds, 1800);
    assert.strictEqual(r2.earliest, '2026-10-22-23');
});

test('parseRecordingFilename handles primary, .partN, and non-matches', () => {
    assert.deepStrictEqual(parseRecordingFilename('radio1-2026-10-23-09.mp3'), {
        folder: 'radio1',
        date: '2026-10-23',
        hour: '09',
        part: 1,
    });

    assert.deepStrictEqual(
        parseRecordingFilename('radio1-2026-10-23-09.part2.mp3'),
        { folder: 'radio1', date: '2026-10-23', hour: '09', part: 2 }
    );

    // Folder names may contain hyphens — the trailing date still anchors.
    assert.deepStrictEqual(
        parseRecordingFilename('bbc-radio-4-2026-01-01-00.part3.mp3'),
        { folder: 'bbc-radio-4', date: '2026-01-01', hour: '00', part: 3 }
    );

    assert.strictEqual(parseRecordingFilename('no-date-here.mp3'), null);
    assert.strictEqual(parseRecordingFilename('radio1-2026-10-23-09.json'), null);
    assert.strictEqual(parseRecordingFilename(''), null);
    assert.strictEqual(parseRecordingFilename(null), null);
});
