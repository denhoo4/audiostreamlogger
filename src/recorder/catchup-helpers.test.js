const test = require('node:test');
const assert = require('node:assert');
const { streamsNeedingCatchup, currentHourDecision } = require('./catchup-helpers');

const streams = [
    { name: 'Radio One', folder: 'radio1', url: 'http://example/1' },
    { name: 'Radio Two', folder: 'radio2', url: 'http://example/2' },
    { name: 'Radio Three', folder: 'radio3', url: 'http://example/3' },
];

test('streamsNeedingCatchup: selects streams with no current-hour recording', () => {
    const existing = new Set(['radio2']); // radio2 already has a file this hour
    const result = streamsNeedingCatchup(streams, (folder) => existing.has(folder));
    assert.deepStrictEqual(result.map((s) => s.folder), ['radio1', 'radio3']);
});

test('streamsNeedingCatchup: skips all when every stream already has a recording', () => {
    const result = streamsNeedingCatchup(streams, () => true);
    assert.deepStrictEqual(result, []);
});

test('streamsNeedingCatchup: selects all when none have a recording (fresh hour)', () => {
    const result = streamsNeedingCatchup(streams, () => false);
    assert.deepStrictEqual(result.map((s) => s.folder), ['radio1', 'radio2', 'radio3']);
});

test('streamsNeedingCatchup: a brand-new stream appearing is selected', () => {
    const existing = new Set(['radio1', 'radio2', 'radio3']);
    const withNew = [...streams, { name: 'Radio New', folder: 'radioNew', url: 'http://example/new' }];
    const result = streamsNeedingCatchup(withNew, (folder) => existing.has(folder));
    assert.deepStrictEqual(result.map((s) => s.folder), ['radioNew']);
});

test('streamsNeedingCatchup: non-array input yields empty list', () => {
    assert.deepStrictEqual(streamsNeedingCatchup(null, () => false), []);
    assert.deepStrictEqual(streamsNeedingCatchup(undefined, () => false), []);
});

// --- currentHourDecision (FEAT-002 .inprogress-aware skip/resume) -----------

test('currentHourDecision: finalised hour (primary present) -> skip', () => {
    assert.strictEqual(
        currentHourDecision({ hasPrimary: true, isActivelyCapturing: false }),
        'skip',
    );
});

test('currentHourDecision: in-progress current hour actively capturing -> skip', () => {
    assert.strictEqual(
        currentHourDecision({ hasPrimary: false, isActivelyCapturing: true }),
        'skip',
    );
});

test('currentHourDecision: no primary + not capturing (fresh or stale .inprogress) -> resume', () => {
    assert.strictEqual(
        currentHourDecision({ hasPrimary: false, isActivelyCapturing: false }),
        'resume',
    );
});

test('currentHourDecision: a finalised hour wins even if somehow still flagged capturing', () => {
    assert.strictEqual(
        currentHourDecision({ hasPrimary: true, isActivelyCapturing: true }),
        'skip',
    );
});

test('currentHourDecision: missing/empty facts default to resume', () => {
    assert.strictEqual(currentHourDecision(), 'resume');
    assert.strictEqual(currentHourDecision({}), 'resume');
});
