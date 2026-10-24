const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// AUDIO_DIR is read from the env at require time by handlers/paths.js, so set it
// to a temp tree BEFORE requiring the handler. audiowaveform is never invoked:
// an injected `run` records its argv and writes a stub .json.
let tmpDir;
let audioDir;
let db;
let handler;

// A fixed clock so the current-hour stamp is deterministic. Containers run
// TZ=Europe/Amsterdam; the test uses the injected `now` so no real clock/TZ is
// consulted beyond local Date getters.
const NOW = new Date(2026, 0, 15, 14, 30, 0); // 2026-01-15 14:xx local
const STAMP = '2026-01-15-14';

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-curhour-'));
    audioDir = path.join(tmpDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    process.env.AUDIO_DIR = audioDir;
    handler = require('../handlers/currenthourpeaks');

    db = new DatabaseSync(path.join(tmpDir, 'app.db'));
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(
        'CREATE TABLE streams (id INTEGER PRIMARY KEY, folder TEXT NOT NULL UNIQUE, codec TEXT)'
    );
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
    db.exec('DELETE FROM streams');
    // Clear any audio/json artifacts from a prior test.
    for (const folder of fs.readdirSync(audioDir)) {
        fs.rmSync(path.join(audioDir, folder), { recursive: true, force: true });
    }
});

function addStream(folder, codec) {
    db.prepare('INSERT INTO streams (folder, codec) VALUES (?, ?)').run(folder, codec);
    fs.mkdirSync(path.join(audioDir, folder), { recursive: true });
}

// Write a fake audio file for a folder at the given stamp/ext.
function writeAudio(folder, stamp, ext) {
    const file = path.join(audioDir, folder, `${folder}-${stamp}.${ext}`);
    fs.writeFileSync(file, 'fake-audio-bytes');
    return file;
}

// A `run` stub that records every (audioPath, jsonPath) call and writes a stub
// json so the overwrite is observable on disk.
function recordingRun() {
    const calls = [];
    const run = (audioPath, jsonPath) => {
        calls.push({ audioPath, jsonPath });
        fs.writeFileSync(jsonPath, JSON.stringify({ regenerated: true }));
    };
    run.calls = calls;
    return run;
}

test('regenerates and overwrites the json for an existing current-hour primary file', () => {
    addStream('radio1', 'mp3');
    writeAudio('radio1', STAMP, 'mp3');
    const jsonPath = path.join(audioDir, 'radio1', `radio1-${STAMP}.json`);
    // Pre-existing stale json must be overwritten.
    fs.writeFileSync(jsonPath, '{"stale":true}');

    const run = recordingRun();
    const summary = handler.regenerateCurrentHourPeaks(db, { now: NOW, run });

    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(run.calls[0].audioPath, path.join(audioDir, 'radio1', `radio1-${STAMP}.mp3`));
    assert.strictEqual(run.calls[0].jsonPath, jsonPath);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonPath, 'utf8')), { regenerated: true });
    assert.match(summary, /1 regenerated/);
});

test('a folder with no current-hour file is skipped with no error and no run call', () => {
    addStream('radio1', 'mp3');
    // No audio file written for radio1.

    const run = recordingRun();
    const summary = handler.regenerateCurrentHourPeaks(db, { now: NOW, run });

    assert.strictEqual(run.calls.length, 0);
    assert.match(summary, /0 regenerated/);
    assert.match(summary, /1 skipped/);
});

test('the per-stream codec extension is honored', () => {
    addStream('radioopus', 'opus');
    const audioPath = writeAudio('radioopus', STAMP, 'opus');

    const run = recordingRun();
    handler.regenerateCurrentHourPeaks(db, { now: NOW, run });

    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(run.calls[0].audioPath, audioPath);
    assert.strictEqual(
        run.calls[0].jsonPath,
        path.join(audioDir, 'radioopus', `radioopus-${STAMP}.json`)
    );
});

test('a .partN file present but no primary is not regenerated (primary only)', () => {
    addStream('radio1', 'mp3');
    // Only a .partN segment exists, no primary <folder>-<stamp>.mp3.
    fs.writeFileSync(
        path.join(audioDir, 'radio1', `radio1-${STAMP}.part2.mp3`),
        'fake-audio-bytes'
    );

    const run = recordingRun();
    const summary = handler.regenerateCurrentHourPeaks(db, { now: NOW, run });

    assert.strictEqual(run.calls.length, 0);
    assert.match(summary, /1 skipped/);
});

test('an injected run that throws is caught + counted and other folders still process', () => {
    addStream('radio1', 'mp3');
    addStream('radio2', 'mp3');
    writeAudio('radio1', STAMP, 'mp3');
    writeAudio('radio2', STAMP, 'mp3');

    const seen = [];
    const run = (audioPath, jsonPath) => {
        seen.push(audioPath);
        if (audioPath.includes('radio1')) {
            throw new Error('audiowaveform exploded');
        }
        fs.writeFileSync(jsonPath, '{}');
    };

    let summary;
    assert.doesNotThrow(() => {
        summary = handler.regenerateCurrentHourPeaks(db, { now: NOW, run });
    });

    // Both folders were attempted; the failing one did not abort the loop.
    assert.strictEqual(seen.length, 2);
    assert.match(summary, /1 regenerated/);
    assert.match(summary, /1 error\(s\)/);
});

test('the stamp comes from the injected now', () => {
    addStream('radio1', 'mp3');
    // File at a DIFFERENT hour than NOW -> must be skipped (not the current hour).
    writeAudio('radio1', '2026-01-15-09', 'mp3');
    // File at the injected-now hour -> must be regenerated.
    writeAudio('radio1', STAMP, 'mp3');

    const run = recordingRun();
    handler.regenerateCurrentHourPeaks(db, { now: NOW, run });

    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(run.calls[0].audioPath, path.join(audioDir, 'radio1', `radio1-${STAMP}.mp3`));
});

test('codec defaulting to mp3 when the column is null', () => {
    addStream('radionull', null);
    const audioPath = writeAudio('radionull', STAMP, 'mp3');

    const run = recordingRun();
    handler.regenerateCurrentHourPeaks(db, { now: NOW, run });

    assert.strictEqual(run.calls.length, 1);
    assert.strictEqual(run.calls[0].audioPath, audioPath);
});
