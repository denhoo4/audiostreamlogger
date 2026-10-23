const { test } = require('node:test');
const assert = require('node:assert');
const { capOutput, OUTPUT_CAP_BYTES } = require('../worker');

const MARKER = '…[output truncated; showing last 64 KiB]\n';

test('capOutput returns output unchanged when under the byte cap', () => {
    const small = 'x'.repeat(100);
    assert.strictEqual(capOutput(small), small);
});

test('capOutput returns output unchanged at exactly the byte cap', () => {
    const exact = 'a'.repeat(OUTPUT_CAP_BYTES);
    assert.strictEqual(Buffer.byteLength(exact, 'utf8'), OUTPUT_CAP_BYTES);
    assert.strictEqual(capOutput(exact), exact);
});

test('capOutput keeps the last OUTPUT_CAP_BYTES bytes and prefixes the marker', () => {
    // ASCII so 1 char == 1 byte: build a tail we can assert against exactly.
    const head = 'H'.repeat(1000);
    const tail = 'T'.repeat(OUTPUT_CAP_BYTES);
    const result = capOutput(head + tail);

    assert.ok(result.startsWith(MARKER));
    const kept = result.slice(MARKER.length);
    // The exact last OUTPUT_CAP_BYTES bytes are retained (the tail, head dropped).
    assert.strictEqual(kept, tail);
    assert.strictEqual(Buffer.byteLength(kept, 'utf8'), OUTPUT_CAP_BYTES);
});

test('capOutput is multi-byte safe: a split leading sequence is dropped, not broken', () => {
    // '€' is 3 UTF-8 bytes. Fill just over the cap with euros so the byte cut
    // lands inside a multi-byte sequence; the lenient decode must drop the
    // partial head byte-run rather than emit U+FFFD.
    const euros = '€'.repeat(Math.ceil(OUTPUT_CAP_BYTES / 3) + 10);
    const result = capOutput(euros);
    const kept = result.slice(MARKER.length);

    assert.ok(result.startsWith(MARKER));
    // No replacement character from a broken sequence at the cut point.
    assert.ok(!kept.includes('\uFFFD'));
    // The retained tail never exceeds the byte budget.
    assert.ok(Buffer.byteLength(kept, 'utf8') <= OUTPUT_CAP_BYTES);
    // Every retained character is a whole euro sign (no partial bytes).
    assert.ok([...kept].every((ch) => ch === '€'));
});
