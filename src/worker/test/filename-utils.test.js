const { test } = require('node:test');
const assert = require('node:assert');
const { extractFileDateTime, parseRecordingParts } = require('../filename-utils');

test('extractFileDateTime returns the YYYY-MM-DD-HH segment from a stamped filename', () => {
    assert.strictEqual(
        extractFileDateTime('radio1-2026-10-23-14'),
        '2026-10-23-14'
    );
    assert.strictEqual(
        extractFileDateTime('2026-01-02-09-extra'),
        '2026-01-02-09'
    );
});

test('extractFileDateTime returns null when there is no date pattern', () => {
    assert.strictEqual(extractFileDateTime('no-date-here'), null);
    assert.strictEqual(extractFileDateTime(''), null);
});

test('parseRecordingParts parses a primary file as part 1 and returns the ext', () => {
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.mp3'), {
        stamp: '2026-10-23-14',
        part: 1,
        ext: 'mp3',
    });
    // Folders may contain hyphens; the date anchors the match.
    assert.deepStrictEqual(parseRecordingParts('bbc-radio-2-2026-01-02-09.mp3'), {
        stamp: '2026-01-02-09',
        part: 1,
        ext: 'mp3',
    });
});

test('parseRecordingParts parses opus/flac filenames and returns their ext', () => {
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.opus'), {
        stamp: '2026-10-23-14',
        part: 1,
        ext: 'opus',
    });
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.flac'), {
        stamp: '2026-10-23-14',
        part: 1,
        ext: 'flac',
    });
});

test('parseRecordingParts parses a .partN segment as part N for any ext', () => {
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.part2.mp3'), {
        stamp: '2026-10-23-14',
        part: 2,
        ext: 'mp3',
    });
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.part5.opus'), {
        stamp: '2026-10-23-14',
        part: 5,
        ext: 'opus',
    });
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.part3.flac'), {
        stamp: '2026-10-23-14',
        part: 3,
        ext: 'flac',
    });
});

test('parseRecordingParts recognizes .aac and still rejects bare/unknown extensions', () => {
    // A bare basename (no extension) is NOT a real filename -> null by default.
    assert.strictEqual(parseRecordingParts('radio1-2026-10-23-14'), null);
    // .aac is an allowlisted recording extension (FEAT-003) -> recognized parse.
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.aac'), {
        stamp: '2026-10-23-14',
        part: 1,
        ext: 'aac',
    });
    // A sidecar/unknown extension is not a recording we manage.
    assert.strictEqual(parseRecordingParts('radio1-2026-10-23-14.json'), null);
});

test('parseRecordingParts bare-key affordance returns ext:null when allowMissingExt', () => {
    assert.deepStrictEqual(
        parseRecordingParts('radio1-2026-10-23-14', { allowMissingExt: true }),
        { stamp: '2026-10-23-14', part: 1, ext: null }
    );
});

test('parseRecordingParts returns null for non-recording names and bad parts', () => {
    assert.strictEqual(parseRecordingParts('no-date-here.mp3'), null);
    assert.strictEqual(parseRecordingParts(''), null);
    assert.strictEqual(parseRecordingParts(null), null);
    // .part0/.part1 are nonsensical (part2 == attempt 1) -> null.
    assert.strictEqual(parseRecordingParts('radio1-2026-10-23-14.part1.mp3'), null);
    assert.strictEqual(parseRecordingParts('radio1-2026-10-23-14.part0.opus'), null);
});
