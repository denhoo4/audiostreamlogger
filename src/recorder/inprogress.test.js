const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    INPROGRESS_DIR,
    STATE_FILE,
    inprogressDir,
    fragmentName,
    readState,
    writeState,
} = require('./inprogress');

// --- pure path/name builders ------------------------------------------------

test('inprogressDir composes audio/<folder>/.inprogress/<stamp>', () => {
    assert.strictEqual(
        inprogressDir('/app/audio', 'radio1', '2026-10-23-14'),
        path.join('/app/audio', 'radio1', INPROGRESS_DIR, '2026-10-23-14'),
    );
});

test('fragmentName is <startOffset>-<attempt>.<ext>', () => {
    assert.strictEqual(fragmentName(0, 0, 'mp3'), '0-0.mp3');
    assert.strictEqual(fragmentName(1234, 2, 'opus'), '1234-2.opus');
    assert.strictEqual(fragmentName(3599, 5, 'aac'), '3599-5.aac');
});

test('fragmentName defaults ext to mp3 and floors fractional offsets', () => {
    assert.strictEqual(fragmentName(10.9, 1), '10-1.mp3');
});

test('fragmentName clamps negative/non-finite offset and attempt to 0', () => {
    assert.strictEqual(fragmentName(-5, -3, 'flac'), '0-0.flac');
    assert.strictEqual(fragmentName(NaN, Infinity, 'mp3'), '0-0.mp3');
});

// --- atomic readState / writeState ------------------------------------------

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'inprogress-'));
}

test('readState returns null for a missing sidecar / missing dir', () => {
    const dir = tmpDir();
    try {
        assert.strictEqual(readState(dir), null);
        assert.strictEqual(readState(path.join(dir, 'does-not-exist')), null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('writeState then readState round-trips the sidecar shape', () => {
    const dir = tmpDir();
    try {
        const state = {
            folder: 'radio1',
            stamp: '2026-10-23-14',
            ext: 'aac',
            copyEligible: true,
            fragments: [
                { file: '0-0.aac', startOffset: 0, plannedDuration: 3600, attempt: 0, status: 'closed', actualDuration: 1800 },
                { file: '1800-1.aac', startOffset: 1800, plannedDuration: 1800, attempt: 1, status: 'open' },
            ],
        };
        writeState(dir, state);
        // The on-disk file is exactly STATE_FILE.
        assert.ok(fs.existsSync(path.join(dir, STATE_FILE)));
        assert.deepStrictEqual(readState(dir), state);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('writeState is atomic: no stray temp file remains after a write', () => {
    const dir = tmpDir();
    try {
        writeState(dir, { folder: 'r', stamp: '2026-10-23-14', ext: 'mp3', copyEligible: false, fragments: [] });
        const left = fs.readdirSync(dir).filter((n) => n !== STATE_FILE);
        assert.deepStrictEqual(left, []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('writeState overwrites a previous sidecar atomically', () => {
    const dir = tmpDir();
    try {
        writeState(dir, { folder: 'r', stamp: 's', ext: 'mp3', copyEligible: false, fragments: [{ file: 'a' }] });
        writeState(dir, { folder: 'r', stamp: 's', ext: 'mp3', copyEligible: false, fragments: [{ file: 'a' }, { file: 'b' }] });
        assert.strictEqual(readState(dir).fragments.length, 2);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('readState returns null for unparseable JSON and normalises a missing fragments array', () => {
    const dir = tmpDir();
    try {
        fs.writeFileSync(path.join(dir, STATE_FILE), '{ this is not json');
        assert.strictEqual(readState(dir), null);

        fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ folder: 'r', stamp: 's', ext: 'mp3' }));
        const state = readState(dir);
        assert.deepStrictEqual(state.fragments, []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('readState returns null for a JSON array / primitive (not an object sidecar)', () => {
    const dir = tmpDir();
    try {
        fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify([1, 2, 3]));
        assert.strictEqual(readState(dir), null);
        fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify('nope'));
        assert.strictEqual(readState(dir), null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
