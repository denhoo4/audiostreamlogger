/**
 * ffmpeg INTEGRATION test for finalize-hour (FEAT-001).
 *
 * Generates small real fragments in a throwaway temp dir, runs finalizeHour for
 * the concat (mp3 + AAC-with-gap) and the AAC no-gap copy-remux paths, then
 * ffprobes each output and asserts its duration matches the target to within a
 * single AAC frame (1024/44100 ~= 0.0232s; we allow +/-0.05s).
 *
 * The concat paths pad to an EXACT full hour (3600s) via `-af apad -t 3600` —
 * padding silence is cheap, so asserting the real 3600s is practical here.
 *
 * The copy-remux path can only TRIM (stream copy cannot pad), so it is driven
 * with a short `hourSeconds` target and a slightly longer source fragment; this
 * exercises the identical argv + spawn logic and proves the `-t` trim lands on
 * the frame. Generating a real 3600s AAC source just to copy-trim it would add
 * minutes of encode time for no extra coverage.
 *
 * Skips cleanly (test context `skip`) when ffmpeg/ffprobe are unavailable so the
 * pure suites still run on a plain node image.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { finalizeHour } = require('./finalize-hour');
const { resolveEncoding } = require('./encoding');

const TOLERANCE = 0.05; // seconds (~ one AAC frame)

function hasBinary(bin) {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
}

const FFMPEG_OK = hasBinary('ffmpeg') && hasBinary('ffprobe');

// Create a `seconds`-long real audio fragment of `ext` in `dir`.
function makeFragment(dir, name, ext, seconds) {
    const out = path.join(dir, name);
    const codecArgs =
        ext === 'aac'
            ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-f', 'adts']
            : ['-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100'];
    // Force stereo so a fragment and the stereo anullsrc silence share a channel
    // layout — the concat filter requires every input to match.
    const r = spawnSync(
        'ffmpeg',
        [
            '-y',
            '-f', 'lavfi',
            '-t', String(seconds),
            '-i', 'sine=frequency=440:sample_rate=44100',
            '-ac', '2',
            ...codecArgs,
            out,
        ],
        { stdio: 'ignore' },
    );
    assert.strictEqual(r.status, 0, `failed to generate fragment ${name}`);
    return out;
}

// Measure the exact played-out duration of a file. A raw ADTS (.aac) stream has
// NO container duration, so ffprobe's `format=duration` is a bitrate GUESS that
// is wildly wrong for loud test tones; we instead count decoded AAC frames
// (each 1024 samples at the known sample rate). Container formats (mp3) carry a
// reliable duration, so a plain format probe is used there.
const AAC_FRAME_SAMPLES = 1024;

function probeDuration(file, sampleRate = 44100) {
    if (file.endsWith('.aac')) {
        const r = spawnSync(
            'ffprobe',
            [
                '-v', 'error',
                '-select_streams', 'a:0',
                '-count_frames',
                '-show_entries', 'stream=nb_read_frames',
                '-of', 'default=nk=1:noprint_wrappers=1',
                file,
            ],
            { encoding: 'utf8' },
        );
        assert.strictEqual(r.status, 0, `ffprobe (frame count) failed for ${file}`);
        const frames = parseInt(r.stdout.trim(), 10);
        return (frames * AAC_FRAME_SAMPLES) / sampleRate;
    }
    const r = spawnSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:noprint_wrappers=1', file],
        { encoding: 'utf8' },
    );
    assert.strictEqual(r.status, 0, `ffprobe failed for ${file}`);
    return parseFloat(r.stdout.trim());
}

async function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashl-finalize-'));
    try {
        return await fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('finalizeHour: mp3 concat with gaps pads to an exact 3600s hour', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        const a = makeFragment(dir, 'a.mp3', 'mp3', 3);
        const b = makeFragment(dir, 'b.mp3', 'mp3', 3);
        const segments = [
            { kind: 'silence', durationSeconds: 5 },
            { kind: 'fragment', durationSeconds: 3, file: a },
            { kind: 'silence', durationSeconds: 10 },
            { kind: 'fragment', durationSeconds: 3, file: b },
            { kind: 'silence', durationSeconds: 3576 },
        ];
        const out = path.join(dir, 'hour.mp3');
        const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160 });
        const res = await finalizeHour(dir, out, enc, { segments });
        assert.strictEqual(res.mode, 'concat');
        const dur = probeDuration(out);
        assert.ok(Math.abs(dur - 3600) <= TOLERANCE, `mp3 hour duration ${dur} != 3600`);
    });
});

test('finalizeHour: AAC WITH a gap transcodes via concat to an exact 3600s hour', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        const a = makeFragment(dir, 'a.aac', 'aac', 3);
        const b = makeFragment(dir, 'b.aac', 'aac', 3);
        const segments = [
            { kind: 'fragment', durationSeconds: 3, file: a },
            { kind: 'silence', durationSeconds: 20 },
            { kind: 'fragment', durationSeconds: 3, file: b },
            { kind: 'silence', durationSeconds: 3574 },
        ];
        const out = path.join(dir, 'hour.aac');
        const enc = resolveEncoding({ codec: 'aac', bitrate_kbps: 192 });
        const res = await finalizeHour(dir, out, enc, { segments });
        assert.strictEqual(res.mode, 'concat');
        const dur = probeDuration(out);
        assert.ok(Math.abs(dur - 3600) <= TOLERANCE, `aac (gap) hour duration ${dur} != 3600`);
    });
});

test('finalizeHour: AAC no-gap copy-remux trims a single fragment onto the target', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        // Source slightly longer than the target so the copy path TRIMS to it.
        const frag = makeFragment(dir, 'frag.aac', 'aac', 6);
        const segments = [{ kind: 'fragment', durationSeconds: 6, file: frag }];
        const out = path.join(dir, 'hour.aac');
        const enc = resolveEncoding({ codec: 'aac', bitrate_kbps: 192 });
        const res = await finalizeHour(dir, out, enc, { segments, hourSeconds: 4 });
        assert.strictEqual(res.mode, 'copy-remux');
        const dur = probeDuration(out);
        assert.ok(Math.abs(dur - 4) <= TOLERANCE, `aac copy-remux duration ${dur} != 4`);
    });
});
