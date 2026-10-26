const test = require('node:test');
const assert = require('node:assert');
const {
    detectSource,
    isCopyEligible,
    parseFfprobeJson,
} = require('./detect-source');

// A fake runFfprobe that resolves a canned ffprobe JSON string (the shape the
// real ffprobe emits with -show_streams -show_format -of json).
function fakeProbeJson({ codecName, formatName }) {
    const payload = {
        streams: [
            { codec_type: 'video', codec_name: 'mjpeg' }, // ignored (not audio)
            { codec_type: 'audio', codec_name: codecName, bit_rate: '192000' },
        ],
        format: { format_name: formatName },
    };
    return () => Promise.resolve(JSON.stringify(payload));
}

test('detectSource: an aac/adts source resolves { codec:aac, formatName:adts }', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: fakeProbeJson({ codecName: 'aac', formatName: 'aac,adts' }),
    });
    assert.deepStrictEqual(detected, { codec: 'aac', formatName: 'aac,adts' });
});

test('detectSource: an aac source reported as bare "aac" resolves to aac', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: fakeProbeJson({ codecName: 'aac', formatName: 'aac' }),
    });
    assert.deepStrictEqual(detected, { codec: 'aac', formatName: 'aac' });
});

test('detectSource: an mp3/mp3 source resolves { codec:mp3, formatName:mp3 }', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: fakeProbeJson({ codecName: 'mp3', formatName: 'mp3' }),
    });
    assert.deepStrictEqual(detected, { codec: 'mp3', formatName: 'mp3' });
});

test('detectSource: a throwing runFfprobe resolves null (never rejects)', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: () => { throw new Error('spawn ENOENT'); },
    });
    assert.strictEqual(detected, null);
});

test('detectSource: a rejecting runFfprobe resolves null (never rejects)', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: () => Promise.reject(new Error('boom')),
    });
    assert.strictEqual(detected, null);
});

test('detectSource: a timeout (runFfprobe resolves null) resolves null', async () => {
    // The default runner resolves null on an execFile timeout; model that by a
    // runner that resolves null directly.
    const detected = await detectSource('http://x/stream', {
        runFfprobe: () => Promise.resolve(null),
    });
    assert.strictEqual(detected, null);
});

test('detectSource: unparseable ffprobe output resolves null', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: () => Promise.resolve('not json at all'),
    });
    assert.strictEqual(detected, null);
});

test('detectSource: ffprobe JSON with no audio stream resolves null', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: () => Promise.resolve(JSON.stringify({
            streams: [{ codec_type: 'video', codec_name: 'h264' }],
            format: { format_name: 'mov,mp4' },
        })),
    });
    assert.strictEqual(detected, null);
});

test('detectSource: accepts an already-parsed { codec, formatName } from the runner', async () => {
    const detected = await detectSource('http://x/stream', {
        runFfprobe: () => Promise.resolve({ codec: 'aac', formatName: 'adts' }),
    });
    assert.deepStrictEqual(detected, { codec: 'aac', formatName: 'adts' });
});

test('parseFfprobeJson: picks the first audio stream codec_name + format_name', () => {
    const out = JSON.stringify({
        streams: [{ codec_type: 'audio', codec_name: 'mp3' }],
        format: { format_name: 'mp3' },
    });
    assert.deepStrictEqual(parseFfprobeJson(out), { codec: 'mp3', formatName: 'mp3' });
});

test('parseFfprobeJson: a missing format_name yields formatName null', () => {
    const out = JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'aac' }] });
    assert.deepStrictEqual(parseFfprobeJson(out), { codec: 'aac', formatName: null });
});

// --- isCopyEligible (local mirror of the api's COPY_ELIGIBLE) ---------------

test('isCopyEligible: aac config + aac/adts source is copy-eligible', () => {
    assert.strictEqual(isCopyEligible('aac', { codec: 'aac', formatName: 'aac,adts' }), true);
    assert.strictEqual(isCopyEligible('aac', { codec: 'aac', formatName: 'adts' }), true);
    assert.strictEqual(isCopyEligible('aac', { codec: 'aac', formatName: 'aac' }), true);
});

test('isCopyEligible: mp3 config + mp3 source is copy-eligible', () => {
    assert.strictEqual(isCopyEligible('mp3', { codec: 'mp3', formatName: 'mp3' }), true);
});

test('isCopyEligible: a codec mismatch is NOT copy-eligible', () => {
    assert.strictEqual(isCopyEligible('aac', { codec: 'mp3', formatName: 'mp3' }), false);
    assert.strictEqual(isCopyEligible('mp3', { codec: 'aac', formatName: 'adts' }), false);
});

test('isCopyEligible: a non-eligible container (e.g. mp4) is NOT copy-eligible', () => {
    assert.strictEqual(isCopyEligible('aac', { codec: 'aac', formatName: 'mov,mp4,m4a' }), false);
});

test('isCopyEligible: opus/flac have no copy path', () => {
    assert.strictEqual(isCopyEligible('opus', { codec: 'opus', formatName: 'ogg' }), false);
    assert.strictEqual(isCopyEligible('flac', { codec: 'flac', formatName: 'flac' }), false);
});

test('isCopyEligible: null detected / missing input is NOT copy-eligible', () => {
    assert.strictEqual(isCopyEligible('aac', null), false);
    assert.strictEqual(isCopyEligible('aac', undefined), false);
    assert.strictEqual(isCopyEligible(null, { codec: 'aac', formatName: 'adts' }), false);
    assert.strictEqual(isCopyEligible('aac', { codec: 'aac', formatName: null }), false);
});
