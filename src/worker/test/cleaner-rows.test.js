const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// AUDIO_DIR is read from the env at require time by handlers/paths.js, so set it
// before requiring the cleaner. Verifies the cleaner deletes the recordings row
// for an unlinked recording and folds a .partN into the same hour row.
let tmpDir;
let audioDir;
let db;
let cleaner;

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

const OLD_STAMP = '2020-01-01-00';
// mtime well past any sane retention window so the cleaner unlinks it.
const OLD_MTIME = new Date('2020-01-01T00:30:00Z');

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-cleaner-rows-'));
    audioDir = path.join(tmpDir, 'audio');
    fs.mkdirSync(path.join(audioDir, 'radio1'), { recursive: true });
    process.env.AUDIO_DIR = audioDir;
    cleaner = require('../handlers/cleaner');

    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // Retention of 1 hour; the fixtures are dated in 2020 so they are always old.
    db.prepare("INSERT INTO app_config (key, value) VALUES ('log_retention', '1')").run();
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

function writeOldFile(name) {
    const p = path.join(audioDir, 'radio1', name);
    fs.writeFileSync(p, 'old-bytes');
    fs.utimesSync(p, OLD_MTIME, OLD_MTIME);
    return p;
}

function rowExists(hour) {
    return (
        db
            .prepare(
                "SELECT COUNT(*) AS n FROM recordings WHERE stream_folder='radio1' AND date='2020-01-01' AND hour=?"
            )
            .get(hour).n > 0
    );
}

test('cleaner deletes the recordings row when it unlinks a recording mp3', () => {
    const p = writeOldFile(`radio1-${OLD_STAMP}.mp3`);
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
         VALUES ('radio1', '2020-01-01', '00', 'radio1/radio1-2020-01-01-00.mp3', 'complete')`
    ).run();

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(p), false, 'file unlinked');
    assert.strictEqual(rowExists('00'), false, 'recordings row removed');
    assert.match(summary, /1 recordings row\(s\) removed/);
});

test('a .partN file maps to and removes the same hour row', () => {
    const p = writeOldFile(`radio1-${OLD_STAMP}.part2.mp3`);
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, segment_count)
         VALUES ('radio1', '2020-01-01', '00', 'radio1/radio1-2020-01-01-00.mp3', 'partial', 2)`
    ).run();

    cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(p), false);
    assert.strictEqual(rowExists('00'), false, 'partN unlink removed the hour row');
});

test('cleaner removes the row for an expired .opus recording', () => {
    const p = writeOldFile(`radio1-${OLD_STAMP}.opus`);
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
         VALUES ('radio1', '2020-01-01', '00', 'radio1/radio1-2020-01-01-00.opus', 'complete')`
    ).run();

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(p), false, 'opus file unlinked');
    assert.strictEqual(rowExists('00'), false, 'opus recordings row removed');
    assert.match(summary, /1 recordings row\(s\) removed/);
});

test('cleaner removes the row for an expired .flac recording', () => {
    const p = writeOldFile(`radio1-${OLD_STAMP}.flac`);
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status)
         VALUES ('radio1', '2020-01-01', '00', 'radio1/radio1-2020-01-01-00.flac', 'complete')`
    ).run();

    cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(p), false, 'flac file unlinked');
    assert.strictEqual(rowExists('00'), false, 'flac recordings row removed');
});

test('a non-recording filename is unlinked without touching recordings', () => {
    const p = writeOldFile('notes.txt');

    // Not a recording name -> no row to remove, no error.
    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(p), false);
    assert.match(summary, /0 recordings row\(s\) removed/);
});
