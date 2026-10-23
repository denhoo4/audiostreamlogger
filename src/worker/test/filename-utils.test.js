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

test('parseRecordingParts parses a primary file as part 1', () => {
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.mp3'), {
        stamp: '2026-10-23-14',
        part: 1,
    });
    // Folders may contain hyphens; the date anchors the match.
    assert.deepStrictEqual(parseRecordingParts('bbc-radio-2-2026-01-02-09.mp3'), {
        stamp: '2026-01-02-09',
        part: 1,
    });
    // Accepts the bare basename (no .mp3 extension) too.
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14'), {
        stamp: '2026-10-23-14',
        part: 1,
    });
});

test('parseRecordingParts parses a .partN segment as part N', () => {
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.part2.mp3'), {
        stamp: '2026-10-23-14',
        part: 2,
    });
    assert.deepStrictEqual(parseRecordingParts('radio1-2026-10-23-14.part5.mp3'), {
        stamp: '2026-10-23-14',
        part: 5,
    });
});

test('parseRecordingParts returns null for non-recording names and bad parts', () => {
    assert.strictEqual(parseRecordingParts('no-date-here.mp3'), null);
    assert.strictEqual(parseRecordingParts(''), null);
    assert.strictEqual(parseRecordingParts(null), null);
    // .part0/.part1 are nonsensical (part2 == attempt 1) -> null.
    assert.strictEqual(parseRecordingParts('radio1-2026-10-23-14.part1.mp3'), null);
    assert.strictEqual(parseRecordingParts('radio1-2026-10-23-14.part0.mp3'), null);
});
