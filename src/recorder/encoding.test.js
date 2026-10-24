const test = require('node:test');
const assert = require('node:assert');
const { resolveEncoding, outputOptionsFor } = require('./encoding');

test('resolveEncoding: the default (mp3/160/null) row resolves to mp3@160', () => {
    const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160, bit_depth: null });
    assert.deepStrictEqual(enc, {
        codec: 'mp3',
        ext: 'mp3',
        bitrate_kbps: 160,
        bit_depth: null,
        clamped: false,
    });
});

test('outputOptionsFor: default mp3@160 is encoding-equivalent to today', () => {
    const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160, bit_depth: null });
    assert.deepStrictEqual(outputOptionsFor(enc), [
        '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100',
    ]);
});

test('outputOptionsFor: mp3 honours an in-set non-default bitrate', () => {
    const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 320, bit_depth: null });
    assert.strictEqual(enc.bitrate_kbps, 320);
    assert.deepStrictEqual(outputOptionsFor(enc), [
        '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
    ]);
});

test('outputOptionsFor: opus maps to libopus at 48000 Hz (libopus rejects 44100)', () => {
    const enc = resolveEncoding({ codec: 'opus', bitrate_kbps: 128, bit_depth: null });
    assert.strictEqual(enc.ext, 'opus');
    // libopus only accepts 8k/12k/16k/24k/48k; 44100 fails to open the encoder
    // and would crash the recorder on every opus capture (caught by the e2e
    // smoke, plan item 23). Opus is internally 48 kHz, so we pin 48000.
    assert.deepStrictEqual(outputOptionsFor(enc), [
        '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000',
    ]);
});

test('outputOptionsFor: opus never emits -ar 44100 (regression: libopus rejects it)', () => {
    for (const bitrate of [64, 96, 128, 160, 192]) {
        const opts = outputOptionsFor(resolveEncoding({ codec: 'opus', bitrate_kbps: bitrate }));
        const arIdx = opts.indexOf('-ar');
        assert.notStrictEqual(arIdx, -1, 'opus args must set an explicit -ar');
        assert.strictEqual(opts[arIdx + 1], '48000');
    }
});

test('outputOptionsFor: flac 16-bit sets sample_fmt s16, no bitrate', () => {
    const enc = resolveEncoding({ codec: 'flac', bitrate_kbps: null, bit_depth: 16 });
    assert.strictEqual(enc.ext, 'flac');
    assert.strictEqual(enc.bitrate_kbps, null);
    assert.deepStrictEqual(outputOptionsFor(enc), [
        '-c:a', 'flac', '-ar', '44100', '-sample_fmt', 's16',
    ]);
});

test('outputOptionsFor: flac 24-bit sets s32 + bits_per_raw_sample 24', () => {
    const enc = resolveEncoding({ codec: 'flac', bitrate_kbps: null, bit_depth: 24 });
    assert.deepStrictEqual(outputOptionsFor(enc), [
        '-c:a', 'flac', '-ar', '44100', '-sample_fmt', 's32', '-bits_per_raw_sample', '24',
    ]);
});

test('resolveEncoding: output options are always an ARRAY, never a string (NFR-3)', () => {
    for (const row of [
        { codec: 'mp3', bitrate_kbps: 160 },
        { codec: 'opus', bitrate_kbps: 96 },
        { codec: 'flac', bit_depth: 24 },
    ]) {
        assert.ok(Array.isArray(outputOptionsFor(resolveEncoding(row))));
    }
});

test('resolveEncoding: an unknown codec clamps to the mp3@160 default (defensive)', () => {
    const enc = resolveEncoding({ codec: 'xyz', bitrate_kbps: 999, bit_depth: 7 });
    assert.deepStrictEqual(enc, {
        codec: 'mp3',
        ext: 'mp3',
        bitrate_kbps: 160,
        bit_depth: null,
        clamped: true,
    });
    assert.deepStrictEqual(outputOptionsFor(enc), [
        '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100',
    ]);
});

test('resolveEncoding: NULL/absent/non-string codec clamps to mp3@160', () => {
    for (const row of [null, {}, { codec: null }, { codec: 42 }]) {
        const enc = resolveEncoding(row);
        assert.strictEqual(enc.codec, 'mp3');
        assert.strictEqual(enc.ext, 'mp3');
        assert.strictEqual(enc.bitrate_kbps, 160);
        assert.strictEqual(enc.clamped, true);
    }
});

test('resolveEncoding: a lossy codec with an out-of-set bitrate falls back to 160', () => {
    const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 999 });
    assert.strictEqual(enc.bitrate_kbps, 160);
    assert.strictEqual(enc.clamped, false);
});

test('resolveEncoding: flac with a missing/bad bit_depth falls back to 16', () => {
    const enc = resolveEncoding({ codec: 'flac', bit_depth: 7 });
    assert.strictEqual(enc.bit_depth, 16);
    assert.strictEqual(enc.clamped, false);
});
