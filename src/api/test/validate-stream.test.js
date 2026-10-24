const { test } = require('node:test');
const assert = require('node:assert');
const {
    validateStream,
    validateFolder,
    validateName,
    validateUrl,
    validateCountry,
    validateQuality,
} = require('../lib/validate-stream');

const BASE = {
    country: 'NL',
    name: 'Glow FM',
    folder: 'glowfm',
    url: 'https://stream.example/glow',
};

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

// --- quality validation (codec / bitrate_kbps / bit_depth) ----------------

test('validateQuality accepts valid lossy and lossless combinations', () => {
    assert.strictEqual(
        validateQuality({ codec: 'mp3', bitrate_kbps: 160 }),
        null
    );
    assert.strictEqual(
        validateQuality({ codec: 'opus', bitrate_kbps: 64 }),
        null
    );
    assert.strictEqual(
        validateQuality({ codec: 'flac', bit_depth: 24 }),
        null
    );
    assert.strictEqual(
        validateQuality({ codec: 'flac', bit_depth: 16 }),
        null
    );
});

test('validateQuality treats an all-absent quality payload as valid (service defaults)', () => {
    assert.strictEqual(validateQuality({}), null);
    assert.strictEqual(
        validateQuality({ codec: undefined, bitrate_kbps: undefined, bit_depth: undefined }),
        null
    );
});

test('validateQuality rejects an unknown codec with {field:codec} (AC-5)', () => {
    assert.deepStrictEqual(validateQuality({ codec: 'xyz' }), {
        field: 'codec',
        error: 'invalid codec',
    });
});

test('validateQuality is case-sensitive: MP3 is not mp3', () => {
    assert.deepStrictEqual(validateQuality({ codec: 'MP3', bitrate_kbps: 160 }), {
        field: 'codec',
        error: 'invalid codec',
    });
});

test('validateQuality rejects flac+bitrate and mp3+bit_depth (AC-6)', () => {
    assert.deepStrictEqual(
        validateQuality({ codec: 'flac', bit_depth: 16, bitrate_kbps: 128 }),
        { field: 'bitrate_kbps', error: 'bitrate not allowed for a lossless codec' }
    );
    assert.deepStrictEqual(
        validateQuality({ codec: 'mp3', bitrate_kbps: 160, bit_depth: 24 }),
        { field: 'bit_depth', error: 'bit_depth not allowed for a lossy codec' }
    );
});

test('validateQuality rejects an out-of-set lossy bitrate (AC-7)', () => {
    assert.deepStrictEqual(validateQuality({ codec: 'mp3', bitrate_kbps: 999 }), {
        field: 'bitrate_kbps',
        error: 'invalid bitrate',
    });
});

test('validateQuality rejects a missing or non-integer lossy bitrate', () => {
    assert.deepStrictEqual(validateQuality({ codec: 'mp3' }), {
        field: 'bitrate_kbps',
        error: 'invalid bitrate',
    });
    assert.deepStrictEqual(validateQuality({ codec: 'opus', bitrate_kbps: 128.5 }), {
        field: 'bitrate_kbps',
        error: 'invalid bitrate',
    });
    assert.deepStrictEqual(validateQuality({ codec: 'mp3', bitrate_kbps: '160' }), {
        field: 'bitrate_kbps',
        error: 'invalid bitrate',
    });
});

test('validateQuality rejects a missing or out-of-set flac bit_depth', () => {
    assert.deepStrictEqual(validateQuality({ codec: 'flac' }), {
        field: 'bit_depth',
        error: 'invalid bit_depth',
    });
    assert.deepStrictEqual(validateQuality({ codec: 'flac', bit_depth: 12 }), {
        field: 'bit_depth',
        error: 'invalid bit_depth',
    });
    assert.deepStrictEqual(validateQuality({ codec: 'flac', bit_depth: 24.0001 }), {
        field: 'bit_depth',
        error: 'invalid bit_depth',
    });
});

test('validateStream accepts a full payload with a valid quality combo', () => {
    assert.strictEqual(
        validateStream({ ...BASE, codec: 'opus', bitrate_kbps: 128 }),
        null
    );
    assert.strictEqual(
        validateStream({ ...BASE, codec: 'flac', bit_depth: 24 }),
        null
    );
});

test('validateStream surfaces a quality failure after the url check', () => {
    assert.deepStrictEqual(validateStream({ ...BASE, codec: 'xyz' }), {
        field: 'codec',
        error: 'invalid codec',
    });
});
