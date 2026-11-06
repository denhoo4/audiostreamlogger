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

// Create a raw-ADTS AAC fragment carrying a NON-ZERO / drifting start PTS — the
// pathological shape FEAT-003 guards against. A live AAC stream can hand the
// recorder a source whose first demuxed packet sits far from 0; copying such a
// source onto a `-t` window without re-anchoring the timestamps can yield a
// short/overlong (or even empty) hour. We fabricate the drift by encoding the
// tone into an mpegts carrier with `-output_ts_offset` (mpegts persists packet
// timestamps, unlike raw ADTS) and then remuxing that carrier back out to raw
// ADTS, so the resulting .aac fragment demuxes with a non-zero start PTS. The
// recorder's copy-remux path (`-fflags +genpts -c copy -t <hour>`) must still
// land the output exactly on the hour boundary.
function makeDriftingAacFragment(dir, name, seconds, offsetSeconds) {
    const carrier = path.join(dir, `${name}.carrier.ts`);
    const out = path.join(dir, name);
    const mk = spawnSync(
        'ffmpeg',
        [
            '-y',
            '-f', 'lavfi',
            '-t', String(seconds),
            '-i', 'sine=frequency=440:sample_rate=44100',
            '-ac', '2',
            '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
            '-output_ts_offset', String(offsetSeconds),
            '-f', 'mpegts', carrier,
        ],
        { stdio: 'ignore' },
    );
    assert.strictEqual(mk.status, 0, `failed to generate drifting carrier for ${name}`);
    // Remux the drifting carrier to raw ADTS without touching the samples.
    const remux = spawnSync(
        'ffmpeg',
        ['-y', '-i', carrier, '-c', 'copy', '-f', 'adts', out],
        { stdio: 'ignore' },
    );
    assert.strictEqual(remux.status, 0, `failed to remux drifting fragment ${name}`);
    return out;
}

// Probe a stream's codec name and sample rate (used to assert the copy path did
// NOT re-encode or resample).
function probeStream(file) {
    const r = spawnSync(
        'ffprobe',
        [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name,sample_rate',
            '-of', 'default=nk=1:noprint_wrappers=1',
            file,
        ],
        { encoding: 'utf8' },
    );
    assert.strictEqual(r.status, 0, `ffprobe (stream) failed for ${file}`);
    const [codec_name, sample_rate] = r.stdout.trim().split('\n');
    return { codec_name, sample_rate: parseInt(sample_rate, 10) };
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

// --- FEAT-003: AAC hour exactness under a drifting source PTS ---------------
// Raw ADTS has no container duration and a live AAC source can present a
// non-zero/drifting start PTS. Copying such a source onto the hour boundary
// without re-anchoring timestamps is the reported cause of short/overlong AAC
// hours. These cases fabricate a drifting-PTS ADTS source and prove BOTH AAC
// finalise paths still produce an exact hour (3600 +/- one AAC frame).

test('finalizeHour: AAC drifting-PTS no-gap copy-remux still lands exactly on the hour (stays a copy)', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        // A single unbroken copy-eligible fragment with a large start-PTS drift.
        // Slightly longer than the target so the copy path TRIMS to the hour.
        const frag = makeDriftingAacFragment(dir, 'frag.aac', 6, 95443);
        const segments = [{ kind: 'fragment', durationSeconds: 6, file: frag }];
        const out = path.join(dir, 'hour.aac');
        const enc = resolveEncoding({ codec: 'aac', bitrate_kbps: 192 });
        const res = await finalizeHour(dir, out, enc, { segments, hourSeconds: 4 });
        // The no-gap single-fragment shape must route through copy-remux: no
        // re-encode, no resample.
        assert.strictEqual(res.mode, 'copy-remux');
        const dur = probeDuration(out);
        assert.ok(Math.abs(dur - 4) <= TOLERANCE, `aac drifting copy-remux duration ${dur} != 4`);
        // Prove it stayed a stream copy: same codec, same sample rate (no resample).
        const { codec_name, sample_rate } = probeStream(out);
        assert.strictEqual(codec_name, 'aac', `copy-remux output codec ${codec_name} != aac`);
        assert.strictEqual(sample_rate, 44100, `copy-remux output sample rate ${sample_rate} != 44100`);
    });
});

test('finalizeHour: AAC drifting-PTS WITH a gap transcodes via concat to an exact 3600s hour', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        // Drifting fragments plus an interior gap -> the timeline carries silence,
        // forcing the concat/re-encode path (copy cannot bridge a gap).
        const a = makeDriftingAacFragment(dir, 'a.aac', 3, 95443);
        const b = makeDriftingAacFragment(dir, 'b.aac', 3, 48211);
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
        assert.ok(Math.abs(dur - 3600) <= TOLERANCE, `aac drifting (gap) hour duration ${dur} != 3600`);
    });
});
