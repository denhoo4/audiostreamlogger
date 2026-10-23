const { test } = require('node:test');
const assert = require('node:assert');
const {
    validateFaviconUpload,
    MIME_EXT,
} = require('../lib/validate-favicon');

test('each allowed type maps to the right extension', () => {
    assert.strictEqual(MIME_EXT['image/png'], 'png');
    assert.strictEqual(MIME_EXT['image/x-icon'], 'ico');
    assert.strictEqual(MIME_EXT['image/vnd.microsoft.icon'], 'ico');
    assert.strictEqual(MIME_EXT['image/svg+xml'], 'svg');
});

test('allowed types with a valid size pass', () => {
    assert.strictEqual(
        validateFaviconUpload({ contentType: 'image/png', byteLength: 1024 }),
        null
    );
    assert.strictEqual(
        validateFaviconUpload({ contentType: 'image/x-icon', byteLength: 10 }),
        null
    );
    assert.strictEqual(
        validateFaviconUpload({
            contentType: 'image/vnd.microsoft.icon',
            byteLength: 10,
        }),
        null
    );
    assert.strictEqual(
        validateFaviconUpload({ contentType: 'image/svg+xml', byteLength: 10 }),
        null
    );
});

test('a content type with charset params still validates', () => {
    assert.strictEqual(
        validateFaviconUpload({
            contentType: 'image/svg+xml; charset=utf-8',
            byteLength: 10,
        }),
        null
    );
});

test('unsupported type is rejected', () => {
    assert.deepStrictEqual(
        validateFaviconUpload({ contentType: 'image/gif', byteLength: 10 }),
        { field: 'file', error: 'unsupported favicon type' }
    );
    assert.deepStrictEqual(
        validateFaviconUpload({ contentType: undefined, byteLength: 10 }),
        { field: 'file', error: 'unsupported favicon type' }
    );
});

test('over-1MiB body is rejected', () => {
    assert.deepStrictEqual(
        validateFaviconUpload({
            contentType: 'image/png',
            byteLength: 1024 * 1024 + 1,
        }),
        { field: 'file', error: 'favicon too large' }
    );
});

test('exactly 1MiB is accepted', () => {
    assert.strictEqual(
        validateFaviconUpload({
            contentType: 'image/png',
            byteLength: 1024 * 1024,
        }),
        null
    );
});

test('zero-length / non-numeric body is rejected as empty', () => {
    assert.deepStrictEqual(
        validateFaviconUpload({ contentType: 'image/png', byteLength: 0 }),
        { field: 'file', error: 'empty favicon' }
    );
    assert.deepStrictEqual(
        validateFaviconUpload({ contentType: 'image/png', byteLength: undefined }),
        { field: 'file', error: 'empty favicon' }
    );
});
