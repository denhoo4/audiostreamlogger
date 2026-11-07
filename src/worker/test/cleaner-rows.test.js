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

// 'YYYY-MM-DD-HH' local-hour stamp a given number of hours before now.
function stampHoursAgo(hoursAgo) {
    const d = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}`;
}

test('the file-retention pass never descends into the .inprogress work dir', () => {
    // A RECENT in-progress dir (current hour) is actively capturing; neither the
    // file-retention pass (it is a dotfile) nor the orphan pass (within the 2h
    // window) may touch its fragments — finalise owns those bytes.
    const inprog = path.join(audioDir, 'radio1', '.inprogress', stampHoursAgo(0));
    fs.mkdirSync(inprog, { recursive: true });
    const frag = path.join(inprog, '0-0.mp3');
    fs.writeFileSync(frag, 'fresh-frag');
    // Even with an ancient mtime the file-retention pass must not reach it.
    fs.utimesSync(frag, OLD_MTIME, OLD_MTIME);
    const sidecar = path.join(inprog, 'state.json');
    fs.writeFileSync(sidecar, '{}');
    fs.utimesSync(sidecar, OLD_MTIME, OLD_MTIME);

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(frag), true, 'current-hour fragment left in place');
    assert.strictEqual(fs.existsSync(sidecar), true, 'sidecar left in place');
    assert.match(summary, /0 orphaned work dir\(s\) removed/);

    fs.rmSync(path.join(audioDir, 'radio1', '.inprogress'), { recursive: true, force: true });
});

test('cleaner ages out an orphaned (never-finalised) .inprogress work dir', () => {
    // A work dir whose hour is well past the orphan window (the recorder crashed
    // mid-hour and never finalised it) is removed (FEAT-004).
    const orphanStamp = stampHoursAgo(5);
    const inprog = path.join(audioDir, 'radio1', '.inprogress', orphanStamp);
    fs.mkdirSync(inprog, { recursive: true });
    fs.writeFileSync(path.join(inprog, '0-0.mp3'), 'stale-frag');
    fs.writeFileSync(path.join(inprog, 'state.json'), '{}');

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(inprog), false, 'orphaned work dir removed');
    assert.match(summary, /1 orphaned work dir\(s\) removed/);

    fs.rmSync(path.join(audioDir, 'radio1', '.inprogress'), { recursive: true, force: true });
});

test('cleaner leaves a recent .inprogress work dir inside the orphan window', () => {
    // One hour ago is still inside the 2h orphan window -> not removed.
    const recentStamp = stampHoursAgo(1);
    const inprog = path.join(audioDir, 'radio1', '.inprogress', recentStamp);
    fs.mkdirSync(inprog, { recursive: true });
    fs.writeFileSync(path.join(inprog, '0-0.mp3'), 'recent-frag');

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(inprog), true, 'recent work dir left in place');
    assert.match(summary, /0 orphaned work dir\(s\) removed/);

    fs.rmSync(path.join(audioDir, 'radio1', '.inprogress'), { recursive: true, force: true });
});

// --- .live preview age-out (FEAT-002) ---------------------------------------

test('the file-retention pass never descends into the .live preview dir', () => {
    // The current hour's preview is a dotfile dir, so the mtime-based retention
    // pass must not reach it even with an ancient mtime. Only the dedicated
    // age-out (below) may ever remove a preview.
    const liveDir = path.join(audioDir, 'radio1', '.live');
    fs.mkdirSync(liveDir, { recursive: true });
    const preview = path.join(liveDir, `${stampHoursAgo(0)}.mp3`);
    fs.writeFileSync(preview, 'fresh-preview');
    fs.utimesSync(preview, OLD_MTIME, OLD_MTIME);

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(preview), true, 'current-hour preview left in place');
    assert.match(summary, /0 stale live preview\(s\) removed/);

    fs.rmSync(liveDir, { recursive: true, force: true });
});

test('cleaner ages out a stale (past-hour) .live preview', () => {
    const liveDir = path.join(audioDir, 'radio1', '.live');
    fs.mkdirSync(liveDir, { recursive: true });
    // Well past the 2h orphan window -> removed (the hour has rolled over and
    // the canonical primary has long been written).
    const stale = path.join(liveDir, `${stampHoursAgo(5)}.aac`);
    fs.writeFileSync(stale, 'stale-preview');

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(stale), false, 'stale preview removed');
    assert.match(summary, /1 stale live preview\(s\) removed/);

    fs.rmSync(liveDir, { recursive: true, force: true });
});

test('cleaner leaves a recent .live preview inside the orphan window', () => {
    const liveDir = path.join(audioDir, 'radio1', '.live');
    fs.mkdirSync(liveDir, { recursive: true });
    // One hour ago: still being referenced / inside the window -> kept.
    const recent = path.join(liveDir, `${stampHoursAgo(1)}.mp3`);
    fs.writeFileSync(recent, 'recent-preview');

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(recent), true, 'recent preview left in place');
    assert.match(summary, /0 stale live preview\(s\) removed/);

    fs.rmSync(liveDir, { recursive: true, force: true });
});

test('cleaner leaves a non-stamp .live entry alone (no guessing)', () => {
    const liveDir = path.join(audioDir, 'radio1', '.live');
    fs.mkdirSync(liveDir, { recursive: true });
    const odd = path.join(liveDir, 'not-a-stamp.mp3');
    fs.writeFileSync(odd, 'x');

    const summary = cleaner.runCleaner(db);

    assert.strictEqual(fs.existsSync(odd), true, 'non-stamp preview name left in place');
    assert.match(summary, /0 stale live preview\(s\) removed/);

    fs.rmSync(liveDir, { recursive: true, force: true });
});
