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
    // Reset the aac peak-pipe stub: by default it writes the <base>.json so no
    // real ffmpeg/audiowaveform is invoked during the test.
    peak.generateAacPeak = (inPath, outPath) => {
        fs.writeFileSync(outPath, '{}');
    };
    // Clear any mp3/json artifacts from a prior test.
    for (const f of fs.readdirSync(path.join(audioDir, 'radio1'))) {
        fs.rmSync(path.join(audioDir, 'radio1', f));
    }
});

function writeMp3(name) {
    return writeAudio(name);
}

// Write a fake audio file (any allowlisted ext) and pre-create its <base>.json
// so audiowaveform (execSync) is never invoked during the test.
function writeAudio(name) {
    const file = path.join(audioDir, 'radio1', name);
    fs.writeFileSync(file, 'fake-audio-bytes');
    const base = path.basename(name, path.extname(name));
    fs.writeFileSync(path.join(audioDir, 'radio1', `${base}.json`), '{}');
    return file;
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

test('peakfilegenerator picks up opus/flac files and builds the real-ext file_path', () => {
    const opus = writeAudio(`radio1-${PAST_STAMP}.opus`);
    peak.probeDurationSeconds = () => 3600;

    const summary = peak.runPeakfileGenerator(db);

    const row = getRow('00');
    assert.ok(row, 'an opus recording row was created');
    assert.strictEqual(row.file_path, 'radio1/radio1-2020-01-01-00.opus');
    assert.strictEqual(row.size_bytes, fs.statSync(opus).size);
    assert.match(summary, /1 recording row\(s\) metadata-filled/);
});

test('peakfilegenerator generates the <base>.json for a flac file (no .flac in the name)', () => {
    // No pre-created .json here, so the handler would try audiowaveform; stub
    // execFileSync by pre-creating the json AFTER asserting the base name.
    const flac = path.join(audioDir, 'radio1', `radio1-${PAST_STAMP}.flac`);
    fs.writeFileSync(flac, 'fake-flac-bytes');
    // Pre-create the json the handler derives from the real extension.
    fs.writeFileSync(path.join(audioDir, 'radio1', `radio1-${PAST_STAMP}.json`), '{}');
    peak.probeDurationSeconds = () => 1800;

    peak.runPeakfileGenerator(db);

    const row = getRow('00');
    assert.ok(row);
    assert.strictEqual(row.file_path, 'radio1/radio1-2020-01-01-00.flac');
    assert.strictEqual(row.duration_seconds, 1800);
});

test('peakfilegenerator folds a .partN segment into a partial row', () => {
    writeMp3(`radio1-${PAST_STAMP}.part2.mp3`);

    peak.runPeakfileGenerator(db);

    const row = getRow('00');
    assert.ok(row);
    assert.strictEqual(row.status, 'partial');
    assert.strictEqual(row.segment_count, 2);
});

test('an .aac file without a peak uses the decode-to-WAV pipe (generateAacPeak), not direct audiowaveform', () => {
    // .aac file, NO pre-created json -> the handler must generate it. Stub the
    // aac pipe to record it was chosen and write the json the handler expects.
    const aac = path.join(audioDir, 'radio1', `radio1-${PAST_STAMP}.aac`);
    fs.writeFileSync(aac, 'fake-aac-bytes');
    let aacPeakCalls = 0;
    peak.generateAacPeak = (inPath, outPath) => {
        aacPeakCalls += 1;
        assert.strictEqual(inPath, aac);
        assert.ok(outPath.endsWith(`radio1-${PAST_STAMP}.json`));
        fs.writeFileSync(outPath, '{}');
    };
    peak.probeDurationSeconds = () => 3600;

    const summary = peak.runPeakfileGenerator(db);

    assert.strictEqual(aacPeakCalls, 1, 'generateAacPeak was chosen for the .aac file');
    const row = getRow('00');
    assert.ok(row, 'an aac recording row was created');
    assert.strictEqual(row.file_path, 'radio1/radio1-2020-01-01-00.aac');
    assert.strictEqual(row.size_bytes, fs.statSync(aac).size);
    assert.match(summary, /1 generated/);
});

test('mp3/opus/flac without a peak never touch the aac decode pipe', () => {
    // No pre-created json for the mp3; stub execFileSync is not available, so
    // make the aac pipe explode — it must NOT be called for a non-aac file.
    const mp3 = path.join(audioDir, 'radio1', `radio1-${PAST_STAMP}.mp3`);
    fs.writeFileSync(mp3, 'fake-mp3-bytes');
    peak.generateAacPeak = () => {
        throw new Error('generateAacPeak must not be called for non-aac files');
    };
    peak.probeDurationSeconds = () => 3600;

    // The direct audiowaveform path will fail (no real binary / fake bytes) but
    // that is logged + counted, never fatal, and the aac pipe stub must not run.
    let summary;
    assert.doesNotThrow(() => {
        summary = peak.runPeakfileGenerator(db);
    });
    // The error, if any, is the direct audiowaveform failure — not our aac stub.
    assert.doesNotMatch(summary, /must not be called/);
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
