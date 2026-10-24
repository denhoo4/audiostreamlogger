/**
 * Reconcile handler functional smoke (FEAT-002).
 *
 * Follows the cleaner-rows.test.js temp-dir + temp-DB pattern: AUDIO_DIR is read
 * from the env at require time by handlers/paths.js, so it is set before the
 * handler is required. A throwaway temp SQLite DB gets the recordings DDL, then
 * four slots exercise the full two-way sync:
 *   - a disk-only OLD-hour file                 -> INSERTED
 *   - a db-only row for an OLD hour (no file)    -> REMOVED (full-sync)
 *   - a drifted row (DB complete/1, disk .part2) -> FIXED to partial/2
 *   - a current-hour 'recording' row             -> left intact (guarded)
 * It asserts the DB end-state AND the summary's added/removed/fixed counts.
 *
 * NEVER touches the real ./audio or ./data, never binds host port 9703, never
 * starts the compose stack. Never sets PRAGMA journal_mode on a shared handle;
 * this temp DB mirrors cleaner-rows.test.js (DELETE journal on a throwaway file).
 */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

let tmpDir;
let audioDir;
let db;
let reconcile;

const RECORDINGS_DDL = `
CREATE TABLE recordings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_folder    TEXT    NOT NULL,
  date             TEXT    NOT NULL,
  hour             TEXT    NOT NULL,
  file_path        TEXT    NOT NULL,
  status           TEXT    NOT NULL
                     CHECK (status IN ('recording','complete','partial','missing')),
  duration_seconds REAL,
  size_bytes       INTEGER,
  segment_count    INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (stream_folder, date, hour)
);
`;

// A fixed OLD slot (never the current hour) for the insert/remove/fix cases.
const OLD_DATE = '2020-01-01';
const OLD_HOUR = '00';

// The current local hour, matching the recorder's filename stamp + the
// handler's currentHourStamp, so a 'recording' row for it is guarded.
function currentStampParts(now) {
    return {
        date:
            `${now.getFullYear()}-` +
            `${String(now.getMonth() + 1).padStart(2, '0')}-` +
            `${String(now.getDate()).padStart(2, '0')}`,
        hour: String(now.getHours()).padStart(2, '0'),
    };
}

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-reconcile-'));
    audioDir = path.join(tmpDir, 'audio');
    fs.mkdirSync(path.join(audioDir, 'radio1'), { recursive: true });
    process.env.AUDIO_DIR = audioDir;
    reconcile = require('../handlers/reconcile');

    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
    db.exec('PRAGMA busy_timeout = 5000');
});

after(() => {
    try {
        db.close();
    } catch {
        // already closed
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.AUDIO_DIR;
});

beforeEach(() => {
    db.exec('DROP TABLE IF EXISTS recordings');
    db.exec(RECORDINGS_DDL);
    for (const f of fs.readdirSync(path.join(audioDir, 'radio1'))) {
        fs.rmSync(path.join(audioDir, 'radio1', f));
    }
});

function writeFile(name) {
    const p = path.join(audioDir, 'radio1', name);
    fs.writeFileSync(p, 'bytes');
    return p;
}

function getRow(date, hour) {
    return db
        .prepare(
            "SELECT status, segment_count FROM recordings WHERE stream_folder='radio1' AND date=? AND hour=?"
        )
        .get(date, hour);
}

test('reconcile inserts disk-only, removes orphan, fixes drift, guards the current hour', () => {
    const now = new Date();
    const cur = currentStampParts(now);

    // Disk-only OLD file -> expect INSERT.
    writeFile(`radio1-${OLD_DATE}-${OLD_HOUR}.mp3`);
    const insertDate = OLD_DATE;
    const insertHour = OLD_HOUR;

    // db-only row for a DIFFERENT old hour (no file) -> expect REMOVE.
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES ('radio1', '2019-06-15', '12', 'radio1/radio1-2019-06-15-12.mp3', 'complete', 1)`
    ).run();

    // Drifted row: DB says complete/1, disk has primary + a .part2 -> fix to partial/2.
    writeFile('radio1-2019-03-03-08.mp3');
    writeFile('radio1-2019-03-03-08.part2.mp3');
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES ('radio1', '2019-03-03', '08', 'radio1/radio1-2019-03-03-08.mp3', 'complete', 1)`
    ).run();

    // Current-hour 'recording' row (no file on disk) -> guarded, left intact.
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES ('radio1', ?, ?, 'radio1/radio1-recording.mp3', 'recording', 1)`
    ).run(cur.date, cur.hour);

    const summary = reconcile.runReconcile(db);

    // Inserted.
    const inserted = getRow(insertDate, insertHour);
    assert.ok(inserted, 'disk-only slot inserted');
    assert.strictEqual(inserted.status, 'complete');
    assert.strictEqual(inserted.segment_count, 1);

    // Removed.
    assert.strictEqual(getRow('2019-06-15', '12'), undefined, 'orphan row removed');

    // Fixed.
    const fixed = getRow('2019-03-03', '08');
    assert.ok(fixed, 'drifted row still present');
    assert.strictEqual(fixed.status, 'partial');
    assert.strictEqual(fixed.segment_count, 2);

    // Guarded current hour left intact.
    const guarded = getRow(cur.date, cur.hour);
    assert.ok(guarded, 'current-hour recording row still present');
    assert.strictEqual(guarded.status, 'recording', 'current hour never restatused');

    // Summary counts.
    assert.match(summary, /1 added/);
    assert.match(summary, /1 removed/);
    assert.match(summary, /1 fixed/);
    assert.match(summary, /0 per-slot error\(s\)/);
});

test('reconcile scans and inserts disk-only opus/flac recordings', () => {
    // Disk-only OLD opus + flac files -> expect INSERTs with their real paths.
    writeFile('radio1-2019-05-05-05.opus');
    writeFile('radio1-2019-06-06-06.flac');

    const summary = reconcile.runReconcile(db);

    const opusRow = db
        .prepare(
            "SELECT status, file_path FROM recordings WHERE stream_folder='radio1' AND date='2019-05-05' AND hour='05'"
        )
        .get();
    assert.ok(opusRow, 'opus slot inserted');
    assert.match(opusRow.file_path, /radio1-2019-05-05-05\.opus$/);

    const flacRow = db
        .prepare(
            "SELECT status, file_path FROM recordings WHERE stream_folder='radio1' AND date='2019-06-06' AND hour='06'"
        )
        .get();
    assert.ok(flacRow, 'flac slot inserted');
    assert.match(flacRow.file_path, /radio1-2019-06-06-06\.flac$/);

    assert.match(summary, /2 added/);
});
