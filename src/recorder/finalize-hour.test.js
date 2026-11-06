const test = require('node:test');
const assert = require('node:assert');
const { buildConcatFinalizeArgs, buildCopyRemuxArgs } = require('./finalize-hour');
const { resolveEncoding } = require('./encoding');

// --- buildConcatFinalizeArgs -------------------------------------------------

test('concat: mp3 single full-hour fragment -> one input, concat, apad, -t 3600', () => {
    const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160 });
    const segs = [{ kind: 'fragment', durationSeconds: 3600, file: 'frag.mp3' }];
    const args = buildConcatFinalizeArgs(segs, enc);
    assert.deepStrictEqual(args, [
        '-y',
        '-i', 'frag.mp3',
        '-filter_complex', '[0:a]concat=n=1:v=0:a=1,apad[out]',
        '-map', '[out]',
        '-t', '3600',
        '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100',
    ]);
});

test('concat: mp3 leading gap uses an anullsrc silence input at 44100 Hz', () => {
    const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160 });
    const segs = [
        { kind: 'silence', durationSeconds: 120 },
        { kind: 'fragment', durationSeconds: 3480, file: 'frag.mp3' },
    ];
    const args = buildConcatFinalizeArgs(segs, enc);
    assert.deepStrictEqual(args, [
        '-y',
        '-f', 'lavfi', '-t', '120', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-i', 'frag.mp3',
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1,apad[out]',
        '-map', '[out]',
        '-t', '3600',
        '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100',
    ]);
});

test('concat: opus silence source is pinned to 48000 Hz (libopus native rate)', () => {
    const enc = resolveEncoding({ codec: 'opus', bitrate_kbps: 128 });
    const segs = [
        { kind: 'silence', durationSeconds: 60 },
        { kind: 'fragment', durationSeconds: 3540, file: 'frag.opus' },
    ];
    const args = buildConcatFinalizeArgs(segs, enc);
    assert.deepStrictEqual(args, [
        '-y',
        '-f', 'lavfi', '-t', '60', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-i', 'frag.opus',
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1,apad[out]',
        '-map', '[out]',
        '-t', '3600',
        '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000',
    ]);
});

test('concat: flac finalise uses the flac output options after concat/apad', () => {
    const enc = resolveEncoding({ codec: 'flac', bit_depth: 16 });
    const segs = [
        { kind: 'fragment', durationSeconds: 3000, file: 'frag.flac' },
        { kind: 'silence', durationSeconds: 600 },
    ];
    const args = buildConcatFinalizeArgs(segs, enc);
    assert.deepStrictEqual(args, [
        '-y',
        '-i', 'frag.flac',
        '-f', 'lavfi', '-t', '600', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1,apad[out]',
        '-map', '[out]',
        '-t', '3600',
        '-c:a', 'flac', '-ar', '44100', '-sample_fmt', 's16',
    ]);
});

test('concat: AAC WITH a gap transcodes via concat (silence forces re-encode) -> adts', () => {
    const enc = resolveEncoding({ codec: 'aac', bitrate_kbps: 192 });
    const segs = [
        { kind: 'fragment', durationSeconds: 1000, file: 'a.aac' },
        { kind: 'silence', durationSeconds: 500 },
        { kind: 'fragment', durationSeconds: 2100, file: 'b.aac' },
    ];
    const args = buildConcatFinalizeArgs(segs, enc);
    assert.deepStrictEqual(args, [
        '-y',
        '-i', 'a.aac',
        '-f', 'lavfi', '-t', '500', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-i', 'b.aac',
        '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1,apad[out]',
        '-map', '[out]',
        '-t', '3600',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-f', 'adts',
    ]);
});

// --- buildCopyRemuxArgs ------------------------------------------------------

test('copy-remux: AAC no-gap fast path is -c copy -t 3600 -f adts (no resample)', () => {
    const enc = resolveEncoding({ codec: 'aac', bitrate_kbps: 192 });
    const args = buildCopyRemuxArgs('frag.aac', enc);
    assert.deepStrictEqual(args, [
        '-y',
        '-fflags', '+genpts',
        '-i', 'frag.aac',
        '-c', 'copy',
        '-t', '3600',
        '-f', 'adts',
    ]);
    assert.strictEqual(args.indexOf('-ar'), -1, 'copy-remux must NOT resample');
    assert.strictEqual(args.indexOf('-b:a'), -1, 'copy-remux must NOT re-bitrate');
});

// --- NFR-3: argv arrays, never shell strings --------------------------------

test('NFR-3: both builders return a flat ARRAY of string args (no shell string)', () => {
    const enc = resolveEncoding({ codec: 'aac', bitrate_kbps: 192 });
    const concat = buildConcatFinalizeArgs(
        [{ kind: 'fragment', durationSeconds: 3600, file: 'a.aac' }],
        enc,
    );
    const copy = buildCopyRemuxArgs('a.aac', enc);
    for (const args of [concat, copy]) {
        assert.ok(Array.isArray(args));
        for (const a of args) {
            assert.strictEqual(typeof a, 'string');
        }
    }
});

test('NFR-3: a fragment path with spaces stays a single literal argv element', () => {
    const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160 });
    const args = buildConcatFinalizeArgs(
        [{ kind: 'fragment', durationSeconds: 3600, file: 'my radio station.mp3' }],
        enc,
    );
    assert.ok(args.includes('my radio station.mp3'));
});
