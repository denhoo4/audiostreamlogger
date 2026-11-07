const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// AUDIO_DIR is read from the env at require time by handlers/paths.js, so set it
// to a temp tree BEFORE requiring the backfill module. The frame-count probe is
// stubbed by reassigning peakfilegenerator's exported probeDurationSeconds, so
// no real .aac / ffprobe binary is needed.
let tmpDir;
let audioDir;
let db;
let backfill;
let peak;

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

// The correct measured length the stubbed probe returns for every .aac file.
const MEASURED = 3600;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-aac-backfill-'));
    audioDir = path.join(tmpDir, 'audio');
    fs.mkdirSync(path.join(audioDir, 'radio1'), { recursive: true });
    process.env.AUDIO_DIR = audioDir;
    peak = require('../handlers/peakfilegenerator');
    backfill = require('../handlers/aac-duration-backfill');

    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
    db.exec('PRAGMA journal_mode = DELETE');
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
    // Every .aac measures to exactly one hour (the correct length).
    peak.probeDurationSeconds = () => MEASURED;
    // Clear the fake audio tree.
    for (const f of fs.readdirSync(path.join(audioDir, 'radio1'))) {
        fs.rmSync(path.join(audioDir, 'radio1', f), { recursive: true, force: true });
    }
});

// Write a fake .aac (or any-ext) recording file into radio1/.
function writeAudio(name) {
    const file = path.join(audioDir, 'radio1', name);
    fs.writeFileSync(file, 'fake-audio-bytes');
    return file;
}

function insertRow({ date, hour, ext = 'aac', duration }) {
    db.prepare(
        `INSERT INTO recordings
           (stream_folder, date, hour, file_path, status, duration_seconds, segment_count)
         VALUES ('radio1', ?, ?, ?, 'complete', ?, 1)`
    ).run(date, hour, `radio1/radio1-${date}-${hour}.${ext}`, duration);
}

function getDuration(hour) {
    return db
        .prepare(
            "SELECT duration_seconds FROM recordings WHERE stream_folder='radio1' AND date='2020-01-01' AND hour=?"
        )
        .get(hour).duration_seconds;
}

test('corrects a .aac row whose duration is the ~16x ADTS overshoot', () => {
    writeAudio('radio1-2020-01-01-00.aac');
    insertRow({ date: '2020-01-01', hour: '00', duration: 57600 }); // ~16x of 3600

    const summary = backfill.runAacDurationBackfill(db);

    assert.strictEqual(getDuration('00'), MEASURED, 'implausible row re-measured');
    assert.strictEqual(summary.corrected, 1);
    assert.strictEqual(summary.scanned, 1);
});

test('corrects a .aac row whose duration is NULL', () => {
    writeAudio('radio1-2020-01-01-01.aac');
    insertRow({ date: '2020-01-01', hour: '01', duration: null });

    const summary = backfill.runAacDurationBackfill(db);

    assert.strictEqual(getDuration('01'), MEASURED, 'NULL row re-measured');
    assert.strictEqual(summary.corrected, 1);
});

test('leaves a .aac row whose duration is already plausible untouched', () => {
    writeAudio('radio1-2020-01-01-02.aac');
    insertRow({ date: '2020-01-01', hour: '02', duration: 3599.25 });

    const summary = backfill.runAacDurationBackfill(db);

    assert.strictEqual(getDuration('02'), 3599.25, 'plausible row untouched');
    assert.strictEqual(summary.corrected, 0);
    assert.strictEqual(summary.skipped, 1);
});

test('is idempotent: a second run corrects nothing', () => {
    writeAudio('radio1-2020-01-01-03.aac');
    insertRow({ date: '2020-01-01', hour: '03', duration: 57600 });

    const first = backfill.runAacDurationBackfill(db);
    assert.strictEqual(first.corrected, 1);
    assert.strictEqual(getDuration('03'), MEASURED);

    const second = backfill.runAacDurationBackfill(db);
    assert.strictEqual(second.corrected, 0, 'second run writes nothing');
    assert.strictEqual(second.skipped, 1, 'the now-plausible row is skipped');
    assert.strictEqual(getDuration('03'), MEASURED, 'duration unchanged on re-run');
});

test('never touches mp3/opus/flac rows (only .aac files are scanned)', () => {
    // A bad-looking mp3 row + file: the walk filters to .aac only, so it is
    // never measured and never rewritten.
    writeAudio('radio1-2020-01-01-04.mp3');
    insertRow({ date: '2020-01-01', hour: '04', ext: 'mp3', duration: 57600 });
    peak.probeDurationSeconds = () => {
        throw new Error('probe must not be called for a non-aac file');
    };

    const summary = backfill.runAacDurationBackfill(db);

    assert.strictEqual(getDuration('04'), 57600, 'mp3 row left as-is');
    assert.strictEqual(summary.scanned, 0, 'no .aac file was scanned');
    assert.strictEqual(summary.corrected, 0);
});

test('skips a .aac file that has no recordings row yet (owned by recorder/peakgen)', () => {
    writeAudio('radio1-2020-01-01-05.aac');
    // No row inserted.

    const summary = backfill.runAacDurationBackfill(db);

    assert.strictEqual(
        db
            .prepare(
                "SELECT COUNT(*) AS n FROM recordings WHERE hour='05'"
            )
            .get().n,
        0,
        'no row was created for the orphan file'
    );
    assert.strictEqual(summary.corrected, 0);
    assert.strictEqual(summary.skipped, 1);
});

test('never descends into a hidden .inprogress/.live dir', () => {
    // A bad .aac row for a finished hour, plus a dotfile dir holding a fragment.
    writeAudio('radio1-2020-01-01-06.aac');
    insertRow({ date: '2020-01-01', hour: '06', duration: 57600 });
    const live = path.join(audioDir, 'radio1', '.live');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, '2020-01-01-07.aac'), 'frag-bytes');

    const summary = backfill.runAacDurationBackfill(db);

    // The finished hour was corrected; the .live fragment was never scanned.
    assert.strictEqual(getDuration('06'), MEASURED);
    assert.strictEqual(summary.scanned, 1, 'only the finished .aac was scanned');

    fs.rmSync(live, { recursive: true, force: true });
});
