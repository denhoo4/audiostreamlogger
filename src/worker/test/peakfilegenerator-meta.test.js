const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// AUDIO_DIR is read from the env at require time by handlers/paths.js, so set it
// to a temp tree BEFORE requiring the handler. ffprobe is stubbed by reassigning
// the handler's exported probeDurationSeconds, so no real mp3/ffprobe is needed.
let tmpDir;
let audioDir;
let db;
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

// A stamp guaranteed NOT to be the current hour, so the handler never skips it.
const PAST_STAMP = '2020-01-01-00';

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-peak-meta-'));
    audioDir = path.join(tmpDir, 'audio');
    fs.mkdirSync(path.join(audioDir, 'radio1'), { recursive: true });
    process.env.AUDIO_DIR = audioDir;
    peak = require('../handlers/peakfilegenerator');

    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('CREATE TABLE streams (id INTEGER PRIMARY KEY, folder TEXT NOT NULL UNIQUE)');
    db.prepare("INSERT INTO streams (folder) VALUES ('radio1')").run();
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
    // Reset the probe stub to a known-good default.
    peak.probeDurationSeconds = () => 3600;
    // Clear any mp3/json artifacts from a prior test.
    for (const f of fs.readdirSync(path.join(audioDir, 'radio1'))) {
        fs.rmSync(path.join(audioDir, 'radio1', f));
    }
});

function writeMp3(name) {
    const mp3 = path.join(audioDir, 'radio1', name);
    fs.writeFileSync(mp3, 'fake-mp3-bytes');
    // Pre-create the .json so audiowaveform (execSync) is never invoked.
    const base = path.basename(name, '.mp3');
    fs.writeFileSync(path.join(audioDir, 'radio1', `${base}.json`), '{}');
    return mp3;
}

function getRow(hour) {
    return db
        .prepare(
            "SELECT * FROM recordings WHERE stream_folder='radio1' AND date='2020-01-01' AND hour=?"
        )
        .get(hour);
}

test('peakfilegenerator fills duration + size on the recordings row', () => {
    const mp3 = writeMp3(`radio1-${PAST_STAMP}.mp3`);
    peak.probeDurationSeconds = () => 3599.25;

    const summary = peak.runPeakfileGenerator(db);

    const row = getRow('00');
    assert.ok(row, 'a recordings row was created/updated');
    assert.strictEqual(row.duration_seconds, 3599.25);
    assert.strictEqual(row.size_bytes, fs.statSync(mp3).size);
    assert.strictEqual(row.status, 'complete');
    assert.match(summary, /1 recording row\(s\) metadata-filled/);
});

test('peakfilegenerator folds a .partN segment into a partial row', () => {
    writeMp3(`radio1-${PAST_STAMP}.part2.mp3`);

    peak.runPeakfileGenerator(db);

    const row = getRow('00');
    assert.ok(row);
    assert.strictEqual(row.status, 'partial');
    assert.strictEqual(row.segment_count, 2);
});

test('a per-file ffprobe failure is logged + counted and never fails the job', () => {
    writeMp3(`radio1-${PAST_STAMP}.mp3`);
    peak.probeDurationSeconds = () => {
        throw new Error('ffprobe exploded');
    };

    // Must not throw — the metadata error is isolated per-file.
    let summary;
    assert.doesNotThrow(() => {
        summary = peak.runPeakfileGenerator(db);
    });

    assert.match(summary, /Error filling recording metadata/);
    assert.match(summary, /1 metadata error\(s\)/);
    // No row written because the probe failed before the upsert.
    assert.strictEqual(getRow('00'), undefined);
});
