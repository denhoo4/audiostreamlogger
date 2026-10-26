/**
 * Unit coverage for the pure codec-detection helpers (lib/codec-detect.js):
 * isCopyEligible / snapBitrate / suggestRecording. No I/O, no child process —
 * table-driven over the decision matrix the recorder (FEAT-002) and the Test
 * button (FEAT-004) consume.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const {
    isCopyEligible,
    snapBitrate,
    suggestRecording,
    COPY_ELIGIBLE,
    FALLBACK,
} = require('../lib/codec-detect');

// --- isCopyEligible --------------------------------------------------------

test('isCopyEligible: true ONLY for config==detected on an eligible container', () => {
    const cases = [
        // configured, detected, formatName -> expected
        ['mp3', 'mp3', 'mp3', true],
        ['aac', 'aac', 'aac', true],
        ['aac', 'aac', 'adts', true],
        // ffprobe comma-joined format_name token still matches.
        ['aac', 'aac', 'aac,adts', true],
        ['mp3', 'mp3', 'mp3,mp2,mp1', true],
    ];
    for (const [cfg, det, fmt, expected] of cases) {
        assert.strictEqual(
            isCopyEligible(cfg, det, fmt),
            expected,
            `isCopyEligible(${cfg}, ${det}, ${fmt})`
        );
    }
});

test('isCopyEligible: false on codec mismatch', () => {
    assert.strictEqual(isCopyEligible('aac', 'mp3', 'mp3'), false);
    assert.strictEqual(isCopyEligible('mp3', 'aac', 'aac'), false);
});

test('isCopyEligible: false for a non-eligible container even when codecs match', () => {
    // mp3 detected inside an mp4/m4a container is NOT a proven copy source.
    assert.strictEqual(isCopyEligible('aac', 'aac', 'mov,mp4,m4a,3gp,3g2,mj2'), false);
    assert.strictEqual(isCopyEligible('mp3', 'mp3', 'wav'), false);
});

test('isCopyEligible: false for opus/flac (no copy path proven)', () => {
    assert.strictEqual(isCopyEligible('opus', 'opus', 'ogg'), false);
    assert.strictEqual(isCopyEligible('flac', 'flac', 'flac'), false);
});

test('isCopyEligible: false on missing / non-string inputs', () => {
    assert.strictEqual(isCopyEligible('aac', null, 'aac'), false);
    assert.strictEqual(isCopyEligible(null, 'aac', 'aac'), false);
    assert.strictEqual(isCopyEligible('aac', 'aac', null), false);
    assert.strictEqual(isCopyEligible('aac', 'aac', undefined), false);
});

test('COPY_ELIGIBLE exposes the proven (codec,container) allowlist', () => {
    assert.ok(COPY_ELIGIBLE.mp3.has('mp3'));
    assert.ok(COPY_ELIGIBLE.aac.has('aac'));
    assert.ok(COPY_ELIGIBLE.aac.has('adts'));
    assert.strictEqual(COPY_ELIGIBLE.opus, undefined);
    assert.strictEqual(COPY_ELIGIBLE.flac, undefined);
});

// --- snapBitrate -----------------------------------------------------------

test('snapBitrate snaps to the nearest allowed bitrate for the codec', () => {
    // aac allowed set: [96,128,160,192,256,320]
    assert.strictEqual(snapBitrate('aac', 190), 192);
    assert.strictEqual(snapBitrate('aac', 200), 192);
    assert.strictEqual(snapBitrate('aac', 300), 320);
    assert.strictEqual(snapBitrate('aac', 10), 96);
    assert.strictEqual(snapBitrate('aac', 9999), 320);
    // mp3 shares the same set.
    assert.strictEqual(snapBitrate('mp3', 161), 160);
    // opus set: [64,96,128,160,192]
    assert.strictEqual(snapBitrate('opus', 70), 64);
});

test('snapBitrate: exact matches return themselves', () => {
    assert.strictEqual(snapBitrate('aac', 192), 192);
    assert.strictEqual(snapBitrate('opus', 128), 128);
});

test('snapBitrate: a midpoint tie resolves to the lower allowed bitrate', () => {
    // 224 is equidistant between 192 and 256 -> lower (192) wins.
    assert.strictEqual(snapBitrate('aac', 224), 192);
});

test('snapBitrate: null for a lossless/unknown codec or a non-number', () => {
    assert.strictEqual(snapBitrate('flac', 192), null);
    assert.strictEqual(snapBitrate('xyz', 192), null);
    assert.strictEqual(snapBitrate('aac', null), null);
    assert.strictEqual(snapBitrate('aac', NaN), null);
});

// --- suggestRecording ------------------------------------------------------

test('suggestRecording maps a known lossy codec to itself with a snapped bitrate', () => {
    assert.deepStrictEqual(suggestRecording('aac', 190), {
        codec: 'aac',
        bitrate_kbps: 192,
        bit_depth: null,
    });
    assert.deepStrictEqual(suggestRecording('mp3', 160), {
        codec: 'mp3',
        bitrate_kbps: 160,
        bit_depth: null,
    });
    assert.deepStrictEqual(suggestRecording('opus', 130), {
        codec: 'opus',
        bitrate_kbps: 128,
        bit_depth: null,
    });
});

test('suggestRecording: a lossy codec with no detected bitrate gets the first allowed value', () => {
    assert.deepStrictEqual(suggestRecording('aac', null), {
        codec: 'aac',
        bitrate_kbps: 96,
        bit_depth: null,
    });
});

test('suggestRecording maps flac to bit_depth 16 (no bitrate)', () => {
    assert.deepStrictEqual(suggestRecording('flac', null), {
        codec: 'flac',
        bitrate_kbps: null,
        bit_depth: 16,
    });
});

test('suggestRecording falls back to mp3/192 for an unknown or absent codec', () => {
    assert.deepStrictEqual(suggestRecording('vorbis', 128), { ...FALLBACK });
    assert.deepStrictEqual(suggestRecording(null, 128), { ...FALLBACK });
    assert.deepStrictEqual(suggestRecording(undefined, null), { ...FALLBACK });
    assert.deepStrictEqual(FALLBACK, { codec: 'mp3', bitrate_kbps: 192, bit_depth: null });
});
