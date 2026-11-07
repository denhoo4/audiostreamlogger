const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const childProcess = require('node:child_process');

// probeDurationSeconds (FEAT-001) branches by extension: for '.aac' it runs the
// -count_frames probe and computes nb_read_frames * 1024 / sample_rate; for
// every other codec it keeps the cheap `format=duration` probe. These tests mock
// child_process.execFileSync so no real ffprobe binary is needed, and assert
// BOTH the exact ffprobe argv chosen AND the derived seconds.
//
// The handler destructures execFileSync at require time, so the module is loaded
// FRESH (require-cache busted) inside each test AFTER the mock is installed.
function loadHandlerFresh() {
    const resolved = require.resolve('../handlers/peakfilegenerator');
    delete require.cache[resolved];
    return require('../handlers/peakfilegenerator');
}

afterEach(() => {
    mock.restoreAll();
    // Drop the freshly-loaded module so the next test re-requires against its
    // own mock, and the other suites get a clean copy too.
    delete require.cache[require.resolve('../handlers/peakfilegenerator')];
});

test('probeDurationSeconds measures a .aac by FRAME COUNT (nb_read_frames*1024/sample_rate)', () => {
    let seenArgs;
    mock.method(childProcess, 'execFileSync', (_bin, args) => {
        seenArgs = args;
        // KEYED output in ffprobe's OWN field order (sample_rate BEFORE
        // nb_read_frames), proving the parser keys by NAME not position.
        // 44.1 kHz, 155039 frames -> 155039*1024/44100 ≈ 3600.0 s.
        return Buffer.from('sample_rate=44100\nnb_read_frames=155039\n');
    });

    const peak = loadHandlerFresh();
    const seconds = peak.probeDurationSeconds('/audio/radio1/radio1-2020-01-01-00.aac', '.aac');

    // The frame-count probe argv was chosen (contains -count_frames), NOT
    // format=duration.
    assert.ok(seenArgs.includes('-count_frames'), 'used the -count_frames probe');
    assert.ok(!seenArgs.includes('format=duration'), 'did not use format=duration for .aac');
    // nb_read_frames * 1024 / sample_rate, within ~1 s of a full hour.
    assert.ok(Math.abs(seconds - 3600) < 1, `expected ~3600, got ${seconds}`);
});

test('probeDurationSeconds keeps the cheap format=duration probe for mp3', () => {
    let seenArgs;
    mock.method(childProcess, 'execFileSync', (_bin, args) => {
        seenArgs = args;
        return Buffer.from('3599.25\n');
    });

    const peak = loadHandlerFresh();
    const seconds = peak.probeDurationSeconds('/audio/radio1/radio1-2020-01-01-00.mp3', '.mp3');

    assert.ok(seenArgs.includes('format=duration'), 'used the format=duration probe for mp3');
    assert.ok(!seenArgs.includes('-count_frames'), 'did not count frames for mp3');
    assert.strictEqual(seconds, 3599.25);
});

test('probeDurationSeconds throws on a non-finite AAC measurement (zero sample rate)', () => {
    mock.method(childProcess, 'execFileSync', () =>
        Buffer.from('sample_rate=0\nnb_read_frames=100\n')
    );

    const peak = loadHandlerFresh();
    assert.throws(
        () => peak.probeDurationSeconds('/audio/radio1/x.aac', '.aac'),
        /non-finite AAC duration/
    );
});

test('probeDurationSeconds defaults the ext from the path when not passed (.aac)', () => {
    let seenArgs;
    mock.method(childProcess, 'execFileSync', (_bin, args) => {
        seenArgs = args;
        return Buffer.from('sample_rate=44100\nnb_read_frames=155039\n');
    });

    const peak = loadHandlerFresh();
    // No explicit ext -> derived from the '.aac' path, so the frame-count probe
    // is still chosen.
    const seconds = peak.probeDurationSeconds('/audio/radio1/radio1-2020-01-01-00.aac');

    assert.ok(seenArgs.includes('-count_frames'));
    assert.ok(Math.abs(seconds - 3600) < 1);
});
