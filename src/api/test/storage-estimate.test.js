/**
 * Pure unit coverage for services/storage-estimate.js::estimateStorage — no DB,
 * no fs, no clock. Each case injects literal `streams`, `measuredByFolder`, and
 * `retentionHours`, mirroring the pure-helper style of stream-health.test.js.
 *
 * Projection formula under test: per stream bytesPerHour * retentionHours,
 * summed into totalProjectedBytes. MEASURED (injected mean > 0) is preferred;
 * otherwise a THEORETICAL bytes/hour is derived from the quality fields and the
 * stream is flagged source:"estimated". FLAC uses the documented constant.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const {
    estimateStorage,
    theoreticalBytesPerHour,
    DEFAULT_LOSSY_KBPS,
    FLAC_ESTIMATED_KBPS,
} = require('../services/storage-estimate');

// kbps → bytes/hour, matching the helper's internal conversion.
const bphFromKbps = (kbps) => (kbps * 1000 / 8) * 3600;

test('measured path: uses the injected mean, source "measured", projected = mean*retention', () => {
    const streams = [
        { folder: 'nl_one', name: 'NL One', codec: 'mp3', bitrate_kbps: 160 },
    ];
    const result = estimateStorage({
        streams,
        measuredByFolder: { nl_one: 5000 },
        retentionHours: 48,
    });

    assert.strictEqual(result.perStream.length, 1);
    const s = result.perStream[0];
    assert.strictEqual(s.folder, 'nl_one');
    assert.strictEqual(s.name, 'NL One');
    assert.strictEqual(s.source, 'measured');
    assert.strictEqual(s.bytesPerHour, 5000);
    assert.strictEqual(s.projectedBytes, 5000 * 48);
    assert.strictEqual(result.totalProjectedBytes, 5000 * 48);
    assert.strictEqual(result.retentionHours, 48);
});

test('estimated lossy mp3/opus: bitrate → bytes/hour formula', () => {
    const streams = [
        { folder: 'mp3s', name: 'MP3', codec: 'mp3', bitrate_kbps: 128 },
        { folder: 'opus', name: 'Opus', codec: 'opus', bitrate_kbps: 96 },
    ];
    const result = estimateStorage({
        streams,
        measuredByFolder: {},
        retentionHours: 1,
    });

    const mp3 = result.perStream[0];
    assert.strictEqual(mp3.source, 'estimated');
    assert.strictEqual(mp3.bytesPerHour, bphFromKbps(128));
    assert.strictEqual(mp3.projectedBytes, bphFromKbps(128));

    const opus = result.perStream[1];
    assert.strictEqual(opus.source, 'estimated');
    assert.strictEqual(opus.bytesPerHour, bphFromKbps(96));
});

test('estimated lossy with null bitrate falls back to the mp3@160 default', () => {
    const streams = [
        { folder: 'nobit', name: 'No Bitrate', codec: 'mp3', bitrate_kbps: null },
    ];
    const result = estimateStorage({
        streams,
        measuredByFolder: {},
        retentionHours: 1,
    });
    assert.strictEqual(DEFAULT_LOSSY_KBPS, 160);
    assert.strictEqual(
        result.perStream[0].bytesPerHour,
        bphFromKbps(DEFAULT_LOSSY_KBPS)
    );
    assert.strictEqual(result.perStream[0].source, 'estimated');
});

test('estimated flac: 16-bit uses the documented constant, 24-bit scales by depth', () => {
    const streams = [
        { folder: 'flac16', name: 'FLAC 16', codec: 'flac', bit_depth: 16 },
        { folder: 'flac24', name: 'FLAC 24', codec: 'flac', bit_depth: 24 },
    ];
    const result = estimateStorage({
        streams,
        measuredByFolder: {},
        retentionHours: 1,
    });

    const flac16 = result.perStream[0];
    assert.strictEqual(flac16.source, 'estimated');
    assert.strictEqual(flac16.bytesPerHour, bphFromKbps(FLAC_ESTIMATED_KBPS));

    const flac24 = result.perStream[1];
    assert.strictEqual(
        flac24.bytesPerHour,
        bphFromKbps(FLAC_ESTIMATED_KBPS * (24 / 16))
    );
});

test('theoreticalBytesPerHour is exported and matches the per-stream math', () => {
    assert.strictEqual(
        theoreticalBytesPerHour({ codec: 'mp3', bitrate_kbps: 320 }),
        bphFromKbps(320)
    );
    // Unknown codec falls back to the lossy default.
    assert.strictEqual(
        theoreticalBytesPerHour({ codec: 'weird', bitrate_kbps: null }),
        bphFromKbps(DEFAULT_LOSSY_KBPS)
    );
});

test('mixed measured + estimated streams roll up into totalProjectedBytes', () => {
    const streams = [
        { folder: 'measured', name: 'Measured', codec: 'mp3', bitrate_kbps: 160 },
        { folder: 'est', name: 'Est', codec: 'mp3', bitrate_kbps: 128 },
    ];
    const result = estimateStorage({
        streams,
        measuredByFolder: { measured: 4000 },
        retentionHours: 2,
    });

    assert.strictEqual(result.perStream[0].source, 'measured');
    assert.strictEqual(result.perStream[0].projectedBytes, 4000 * 2);
    assert.strictEqual(result.perStream[1].source, 'estimated');
    assert.strictEqual(
        result.perStream[1].projectedBytes,
        bphFromKbps(128) * 2
    );
    assert.strictEqual(
        result.totalProjectedBytes,
        4000 * 2 + bphFromKbps(128) * 2
    );
});

test('zero / absent / NaN retention → 0 projections (but bytesPerHour still reported)', () => {
    const streams = [
        { folder: 'a', name: 'A', codec: 'mp3', bitrate_kbps: 160 },
    ];
    for (const retentionHours of [0, -5, NaN, undefined]) {
        const result = estimateStorage({
            streams,
            measuredByFolder: {},
            retentionHours,
        });
        assert.strictEqual(result.retentionHours, 0);
        assert.strictEqual(result.perStream[0].projectedBytes, 0);
        assert.strictEqual(result.totalProjectedBytes, 0);
        assert.ok(result.perStream[0].bytesPerHour > 0);
    }
});

test('a measured value of 0 or non-finite is treated as estimated', () => {
    const streams = [
        { folder: 'zero', name: 'Zero', codec: 'mp3', bitrate_kbps: 160 },
        { folder: 'nan', name: 'NaN', codec: 'mp3', bitrate_kbps: 160 },
    ];
    const result = estimateStorage({
        streams,
        measuredByFolder: { zero: 0, nan: NaN },
        retentionHours: 1,
    });
    assert.strictEqual(result.perStream[0].source, 'estimated');
    assert.strictEqual(result.perStream[1].source, 'estimated');
});

test('empty streams → empty perStream, total 0', () => {
    const result = estimateStorage({
        streams: [],
        measuredByFolder: {},
        retentionHours: 24,
    });
    assert.deepStrictEqual(result.perStream, []);
    assert.strictEqual(result.totalProjectedBytes, 0);
    assert.strictEqual(result.retentionHours, 24);
});
