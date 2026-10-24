const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { isValidFolder, isContainedPath } = require('./folder-utils');

test('isValidFolder: accepts allowlisted lowercase folders', () => {
    assert.strictEqual(isValidFolder('radio1'), true);
    assert.strictEqual(isValidFolder('npo-radio_2'), true);
    assert.strictEqual(isValidFolder('100nl'), true);
});

test('isValidFolder: rejects uppercase', () => {
    assert.strictEqual(isValidFolder('Radio1'), false);
});

test('isValidFolder: rejects empty and non-string', () => {
    assert.strictEqual(isValidFolder(''), false);
    assert.strictEqual(isValidFolder(undefined), false);
    assert.strictEqual(isValidFolder(null), false);
    assert.strictEqual(isValidFolder(42), false);
    assert.strictEqual(isValidFolder({}), false);
});

test('isValidFolder: rejects path separators and dot segments', () => {
    assert.strictEqual(isValidFolder('../x'), false);
    assert.strictEqual(isValidFolder('a/b'), false);
    assert.strictEqual(isValidFolder('.'), false);
    assert.strictEqual(isValidFolder('..'), false);
    assert.strictEqual(isValidFolder('/etc'), false);
});

test('isContainedPath: an allowlisted folder resolves inside baseDir', () => {
    const base = path.join('/srv', 'audio');
    assert.strictEqual(isContainedPath(base, 'radio1'), true);
    assert.strictEqual(isContainedPath(base, 'npo-radio_2'), true);
});

test('isContainedPath: traversal escaping baseDir is rejected', () => {
    const base = path.join('/srv', 'audio');
    assert.strictEqual(isContainedPath(base, '../escape'), false);
});

test('isContainedPath: an absolute path is rejected', () => {
    const base = path.join('/srv', 'audio');
    assert.strictEqual(isContainedPath(base, '/etc'), false);
});
