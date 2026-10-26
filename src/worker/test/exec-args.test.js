const { test } = require('node:test');
const assert = require('node:assert');
const {
    audiowaveformArgs,
    ffprobeDurationArgs,
    ffmpegDecodeToWavArgs,
    audiowaveformStdinArgs,
} = require('../handlers/exec-args');

// These assert the EXACT argv arrays, proving that paths are passed through as
// separate, verbatim elements with no shell quoting/interpolation — which is
// what makes execFileSync (no shell) safe against awkward paths.

test('audiowaveformArgs returns the exact argv with paths passed through verbatim', () => {
    const args = audiowaveformArgs('/a/in file.mp3', '/a/out".json');
    assert.deepStrictEqual(args, [
        '-i',
        '/a/in file.mp3',
        '-o',
        '/a/out".json',
        '--pixels-per-second',
        '20',
        '--bits',
        '8',
    ]);
    // The in/out paths are discrete elements, not embedded in a quoted string.
    assert.strictEqual(args[1], '/a/in file.mp3');
    assert.strictEqual(args[3], '/a/out".json');
});

test('ffprobeDurationArgs returns the exact argv ending in the raw path', () => {
    const args = ffprobeDurationArgs('/a/in file.mp3');
    assert.deepStrictEqual(args, [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nk=1:noprint_wrappers=1',
        '/a/in file.mp3',
    ]);
    assert.strictEqual(args[args.length - 1], '/a/in file.mp3');
});

test('ffmpegDecodeToWavArgs returns the exact argv decoding to a WAV stream on stdout', () => {
    const args = ffmpegDecodeToWavArgs('/a/in file.aac');
    assert.deepStrictEqual(args, ['-i', '/a/in file.aac', '-f', 'wav', '-']);
    // The input path is a discrete element; output goes to stdout ('-').
    assert.strictEqual(args[1], '/a/in file.aac');
    assert.strictEqual(args[args.length - 1], '-');
});

test('audiowaveformStdinArgs returns the exact argv reading WAV from stdin', () => {
    const args = audiowaveformStdinArgs('/a/out".json');
    assert.deepStrictEqual(args, [
        '--input-format',
        'wav',
        '-i',
        '-',
        '-o',
        '/a/out".json',
        '--pixels-per-second',
        '20',
        '--bits',
        '8',
    ]);
    // Input is stdin ('-'); the output path is a discrete, verbatim element.
    assert.strictEqual(args[3], '-');
    assert.strictEqual(args[5], '/a/out".json');
});
