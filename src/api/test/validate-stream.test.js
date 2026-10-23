const { test } = require('node:test');
const assert = require('node:assert');
const {
    validateStream,
    validateFolder,
    validateName,
    validateUrl,
    validateCountry,
} = require('../lib/validate-stream');

test('folder accepts lowercase/digits/dash/underscore', () => {
    assert.strictEqual(validateFolder('glowfm'), null);
    assert.strictEqual(validateFolder('a-b_c'), null);
});

test('folder rejects uppercase and path traversal', () => {
    assert.deepStrictEqual(validateFolder('UPPER'), {
        field: 'folder',
        error: 'invalid folder',
    });
    assert.deepStrictEqual(validateFolder('../bad'), {
        field: 'folder',
        error: 'invalid folder',
    });
});

test('url accepts http and https', () => {
    assert.strictEqual(validateUrl('http://x'), null);
    assert.strictEqual(validateUrl('https://x'), null);
});

test('url rejects non-http(s), bad protocols, garbage and missing protocol', () => {
    assert.strictEqual(validateUrl('ftp://x').field, 'url');
    assert.strictEqual(validateUrl('javascript:x').field, 'url');
    assert.strictEqual(validateUrl('garbage').field, 'url');
    assert.strictEqual(validateUrl('x').field, 'url');
});

test('required fields reject empty/missing name and url', () => {
    assert.strictEqual(validateName('').field, 'name');
    assert.strictEqual(validateName(undefined).field, 'name');
    assert.strictEqual(validateUrl('').field, 'url');
    assert.strictEqual(validateUrl(undefined).field, 'url');
});

test('country accepts valid uppercase alpha-2 codes', () => {
    assert.strictEqual(validateCountry('NL'), null);
    assert.strictEqual(validateCountry('US'), null);
    assert.strictEqual(validateCountry('DE'), null);
});

test('country rejects full name, unknown codes, lowercase, short and alpha-3', () => {
    assert.strictEqual(validateCountry('Netherlands').field, 'country');
    assert.strictEqual(validateCountry('XX').field, 'country');
    assert.strictEqual(validateCountry('ZZ').field, 'country');
    assert.strictEqual(validateCountry('nl').field, 'country');
    assert.strictEqual(validateCountry('N').field, 'country');
    assert.strictEqual(validateCountry('NLD').field, 'country');
});

test('validateStream returns null for a fully valid payload', () => {
    assert.strictEqual(
        validateStream({
            country: 'NL',
            name: 'Glow FM',
            folder: 'glowfm',
            url: 'https://stream.example/glow',
        }),
        null
    );
});

test('validateStream surfaces the first invalid field', () => {
    const result = validateStream({
        country: 'Netherlands',
        name: 'Glow FM',
        folder: 'glowfm',
        url: 'https://x',
    });
    assert.deepStrictEqual(result, { field: 'country', error: 'invalid country' });
});
