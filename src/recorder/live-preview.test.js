const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeLivePreview, liveDir, livePreviewName, LIVE_DIR } = require('./live-preview');
const { inprogressDir, writeState } = require('./inprogress');

function tmpAudioBase() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'live-preview-'));
}

// A fixed "now" 30 minutes + 15 seconds into the hour -> elapsed = 1815s.
const NOW = new Date(2026, 9, 23, 14, 30, 15, 0); // 2026-10-23 14:30:15 local
const STAMP = '2026-10-23-14';
const ELAPSED = 30 * 60 + 15;

// --- pure name/path builders ------------------------------------------------

test('liveDir composes audio/<folder>/.live', () => {
    assert.strictEqual(liveDir('/app/audio', 'radio1'), path.join('/app/audio', 'radio1', LIVE_DIR));
    assert.strictEqual(LIVE_DIR, '.live');
});

test('livePreviewName is a bare <stamp>.<ext>, DISTINCT from the canonical primary', () => {
    const name = livePreviewName(STAMP, 'aac');
    assert.strictEqual(name, '2026-10-23-14.aac');
    // The canonical primary is `<folder>-<stamp>.<ext>`; the preview name must
    // never be able to equal it for any folder.
    assert.ok(!name.startsWith('radio1-'));
});

// --- writeLivePreview behaviour ---------------------------------------------

test('no sidecar -> no-op (no finalizeHour, no .live dir)', async () => {
    const audioBase = tmpAudioBase();
    try {
        let finalizeCalls = 0;
        const res = await writeLivePreview(audioBase, 'radio1', STAMP, { codec: 'mp3', ext: 'mp3' }, {
            readState: () => null,
            finalizeHour: async () => { finalizeCalls += 1; },
            now: NOW,
            log: { error() {} },
        });
        assert.strictEqual(res.written, false);
        assert.strictEqual(res.reason, 'no-sidecar');
        assert.strictEqual(finalizeCalls, 0);
        assert.ok(!fs.existsSync(liveDir(audioBase, 'radio1')));
    } finally {
        fs.rmSync(audioBase, { recursive: true, force: true });
    }
});

test('empty fragments -> no-op', async () => {
    const audioBase = tmpAudioBase();
    try {
        let finalizeCalls = 0;
        const res = await writeLivePreview(audioBase, 'radio1', STAMP, { codec: 'mp3', ext: 'mp3' }, {
            readState: () => ({ folder: 'radio1', stamp: STAMP, ext: 'mp3', fragments: [] }),
            finalizeHour: async () => { finalizeCalls += 1; },
            now: NOW,
            log: { error() {} },
        });
        assert.strictEqual(res.written, false);
        assert.strictEqual(res.reason, 'no-sidecar');
        assert.strictEqual(finalizeCalls, 0);
    } finally {
        fs.rmSync(audioBase, { recursive: true, force: true });
    }
});

test('2-fragment sidecar -> finalizeHour called with hourSeconds === elapsed and atomic temp+rename into .live/<stamp>.<ext>', async () => {
    const audioBase = tmpAudioBase();
    try {
        const state = {
            folder: 'radio1',
            stamp: STAMP,
            ext: 'mp3',
            copyEligible: false,
            fragments: [
                { file: '0-0.mp3', startOffset: 0, actualDuration: 900, status: 'closed' },
                { file: '900-1.mp3', startOffset: 900, actualDuration: 900, status: 'open' },
            ],
        };

        const finalizeArgs = [];
        let tmpSeenAtFinalize = null;
        const res = await writeLivePreview(audioBase, 'radio1', STAMP, { codec: 'mp3', ext: 'mp3' }, {
            readState: () => state,
            finalizeHour: async (workDir, outPath, enc, opts) => {
                finalizeArgs.push({ workDir, outPath, enc, opts });
                // Simulate ffmpeg producing the temp output so the rename works.
                tmpSeenAtFinalize = outPath;
                fs.writeFileSync(outPath, 'FAKE-AUDIO');
            },
            now: NOW,
            log: { error() {} },
        });

        assert.strictEqual(res.written, true);
        assert.strictEqual(finalizeArgs.length, 1);
        const call = finalizeArgs[0];
        // cwd is the current-hour .inprogress work dir so fragment paths resolve.
        assert.strictEqual(call.workDir, inprogressDir(audioBase, 'radio1', STAMP));
        // ELAPSED-length, NOT a 3600s pad.
        assert.strictEqual(call.opts.hourSeconds, ELAPSED);
        // The timeline covers exactly `elapsed` seconds (fragments + trailing
        // silence to the elapsed cursor), never 3600.
        const totalSegs = call.opts.segments.reduce((s, seg) => s + seg.durationSeconds, 0);
        assert.strictEqual(totalSegs, ELAPSED);

        // finalizeHour wrote to a TEMP name, not the final preview name.
        assert.ok(path.basename(tmpSeenAtFinalize).startsWith('.live-tmp.'));
        assert.notStrictEqual(path.basename(tmpSeenAtFinalize), livePreviewName(STAMP, 'mp3'));

        // After the atomic rename the stable preview exists and the temp is gone.
        const previewPath = path.join(liveDir(audioBase, 'radio1'), livePreviewName(STAMP, 'mp3'));
        assert.strictEqual(res.previewPath, previewPath);
        assert.ok(fs.existsSync(previewPath));
        assert.strictEqual(fs.readFileSync(previewPath, 'utf8'), 'FAKE-AUDIO');
        const leftovers = fs.readdirSync(liveDir(audioBase, 'radio1')).filter((n) => n.startsWith('.live-tmp.'));
        assert.deepStrictEqual(leftovers, []);
    } finally {
        fs.rmSync(audioBase, { recursive: true, force: true });
    }
});

test('NEVER targets the canonical primary <folder>-<stamp>.<ext>', async () => {
    const audioBase = tmpAudioBase();
    try {
        const state = {
            folder: 'radio1',
            stamp: STAMP,
            ext: 'aac',
            fragments: [{ file: '0-0.aac', startOffset: 0, actualDuration: 1000, status: 'open' }],
        };
        const outPaths = [];
        await writeLivePreview(audioBase, 'radio1', STAMP, { codec: 'aac', ext: 'aac' }, {
            readState: () => state,
            finalizeHour: async (_workDir, outPath) => {
                outPaths.push(outPath);
                fs.writeFileSync(outPath, 'x');
            },
            now: NOW,
            log: { error() {} },
        });
        const canonicalPrimary = path.join(audioBase, 'radio1', 'radio1-' + STAMP + '.aac');
        // Neither the temp output nor the final preview is ever the canonical name,
        // and the canonical primary file is never created by the preview path.
        for (const p of outPaths) {
            assert.notStrictEqual(p, canonicalPrimary);
        }
        const previewPath = path.join(liveDir(audioBase, 'radio1'), livePreviewName(STAMP, 'aac'));
        assert.notStrictEqual(previewPath, canonicalPrimary);
        assert.ok(!fs.existsSync(canonicalPrimary));
    } finally {
        fs.rmSync(audioBase, { recursive: true, force: true });
    }
});

test('a finalizeHour failure is swallowed (best-effort) and reported, no throw', async () => {
    const audioBase = tmpAudioBase();
    try {
        const state = {
            folder: 'radio1',
            stamp: STAMP,
            ext: 'mp3',
            fragments: [{ file: '0-0.mp3', startOffset: 0, actualDuration: 500, status: 'open' }],
        };
        const errors = [];
        const res = await writeLivePreview(audioBase, 'radio1', STAMP, { codec: 'mp3', ext: 'mp3' }, {
            readState: () => state,
            finalizeHour: async () => { throw new Error('ffmpeg boom'); },
            now: NOW,
            log: { error: (...a) => errors.push(a.join(' ')) },
        });
        assert.strictEqual(res.written, false);
        assert.strictEqual(res.reason, 'error');
        assert.ok(errors.some((e) => e.includes('live preview failed')));
    } finally {
        fs.rmSync(audioBase, { recursive: true, force: true });
    }
});

test('uses a real on-disk sidecar via writeState + default readState', async () => {
    const audioBase = tmpAudioBase();
    try {
        const workDir = inprogressDir(audioBase, 'radio1', STAMP);
        fs.mkdirSync(workDir, { recursive: true });
        writeState(workDir, {
            folder: 'radio1',
            stamp: STAMP,
            ext: 'mp3',
            copyEligible: false,
            fragments: [{ file: '0-0.mp3', startOffset: 0, actualDuration: 600, status: 'open' }],
        });
        let called = false;
        const res = await writeLivePreview(audioBase, 'radio1', STAMP, { codec: 'mp3', ext: 'mp3' }, {
            // default readState reads the real sidecar we just wrote.
            finalizeHour: async (_workDir, outPath) => {
                called = true;
                fs.writeFileSync(outPath, 'x');
            },
            now: NOW,
            log: { error() {} },
        });
        assert.ok(called);
        assert.strictEqual(res.written, true);
    } finally {
        fs.rmSync(audioBase, { recursive: true, force: true });
    }
});
