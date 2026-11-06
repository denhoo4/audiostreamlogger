/**
 * Pure (no-ffmpeg) tests for the finalise core + boot-isolation behaviour
 * (hotfix RC1/RC2/RC3/RC4).
 *
 * These exercise the fail-safe contract WITHOUT a real ffmpeg binary by
 * injecting the `finalizeHour` seam and an in-memory `fs`, so they run in the
 * pure baseline suite (no skip). They cover:
 *   - a ledger with a missing fragment is filtered to a usable subset and the
 *     injected finalize is called with silence-widened segments (RC2);
 *   - an all-missing ledger returns a clean { finalized:false,
 *     reason:'no-usable-fragments' } skip and never calls finalize (RC2/RC3);
 *   - a REJECTING finalize removes the half-written temp and re-throws, leaking
 *     NO temp (RC3), and that rejection does not escape as an unhandled
 *     rejection when wrapped in the recorder's mutex-cleanup pattern (RC1a);
 *   - the boot ordering runs current-hour catch-up EVEN IF the past-hour
 *     finalise rejects, and that rejection is handled, not fatal (RC4/RC1b).
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { finalizeSidecar } = require('./finalize-sidecar');

// A tiny in-memory fs double covering only what finalizeSidecar touches:
// statSync (size), renameSync, existsSync, rmSync. Files are a Map of
// absolute-ish path -> { size }.
function makeFakeFs(initial = {}) {
    const files = new Map(Object.entries(initial));
    return {
        files,
        statSync(p) {
            if (!files.has(p)) {
                const err = new Error(`ENOENT: ${p}`);
                err.code = 'ENOENT';
                throw err;
            }
            return { size: files.get(p).size };
        },
        existsSync(p) {
            return files.has(p);
        },
        renameSync(from, to) {
            if (!files.has(from)) {
                const err = new Error(`ENOENT rename ${from}`);
                err.code = 'ENOENT';
                throw err;
            }
            files.set(to, files.get(from));
            files.delete(from);
        },
        rmSync(p) {
            files.delete(p);
        },
    };
}

const enc = { codec: 'mp3', ext: 'mp3' };

test('finalizeSidecar: drops a missing fragment and finalizes with the usable subset (RC2)', async () => {
    const workDir = '/w';
    const folderDir = '/f';
    // Only 0-0.mp3 exists on disk; 956-0.mp3 is missing.
    const fs = makeFakeFs({ [path.join(workDir, '0-0.mp3')]: { size: 10 } });

    let seenSegments = null;
    const finalizeHour = async (_wd, tmpPath, _enc, opts) => {
        seenSegments = opts.segments;
        fs.files.set(tmpPath, { size: 123 }); // simulate ffmpeg writing the temp
        return { mode: 'concat' };
    };

    const fragments = [
        { file: '0-0.mp3', startOffset: 0, actualDuration: 1800 },
        { file: '956-0.mp3', startOffset: 1800, actualDuration: 1800 },
    ];
    const status = await finalizeSidecar(
        { workDir, folderDir, primaryName: 'f-stamp.mp3', tmpName: '.finalize.x.mp3', fragments, enc },
        { fs, finalizeHour, log: { warn() {}, info() {} } },
    );

    assert.strictEqual(status.finalized, true);
    assert.strictEqual(status.fragments, 1, 'only the on-disk fragment survives');
    // The missing fragment's range became silence; timeline still sums to 3600.
    const total = seenSegments.reduce((a, s) => a + s.durationSeconds, 0);
    assert.strictEqual(total, 3600);
    assert.ok(seenSegments.some((s) => s.kind === 'silence'), 'a silence segment replaces the missing fragment');
    // Primary exists (temp renamed), no temp left behind.
    assert.ok(fs.existsSync(path.join(folderDir, 'f-stamp.mp3')));
    assert.ok(!fs.existsSync(path.join(folderDir, '.finalize.x.mp3')));
});

test('finalizeSidecar: all fragments missing -> clean skip, finalize never called, no temp (RC2/RC3)', async () => {
    const fs = makeFakeFs({}); // nothing on disk
    let called = false;
    const finalizeHour = async () => { called = true; return { mode: 'concat' }; };

    const fragments = [
        { file: '0-0.mp3', startOffset: 0, actualDuration: 1800 },
        { file: '956-0.mp3', startOffset: 1800, actualDuration: 1800 },
    ];
    const status = await finalizeSidecar(
        { workDir: '/w', folderDir: '/f', primaryName: 'f-stamp.mp3', tmpName: '.finalize.x.mp3', fragments, enc },
        { fs, finalizeHour, log: { warn() {} } },
    );

    assert.strictEqual(status.finalized, false);
    assert.strictEqual(status.reason, 'no-usable-fragments');
    assert.strictEqual(called, false, 'ffmpeg must not run when nothing is usable');
    assert.ok(!fs.existsSync(path.join('/f', 'f-stamp.mp3')));
    assert.ok(!fs.existsSync(path.join('/f', '.finalize.x.mp3')));
});

test('finalizeSidecar: a REJECTING finalize removes its half-written temp and re-throws, leaking no temp (RC3)', async () => {
    const workDir = '/w';
    const folderDir = '/f';
    const fs = makeFakeFs({ [path.join(workDir, '0-0.mp3')]: { size: 10 } });
    const tmpName = '.finalize.x.mp3';

    const finalizeHour = async (_wd, tmpPath) => {
        // Simulate ffmpeg creating the temp then exiting non-zero.
        fs.files.set(tmpPath, { size: 0 });
        throw new Error('ffmpeg finalise exited 1: 956-0.mp3: No such file or directory');
    };

    const fragments = [{ file: '0-0.mp3', startOffset: 0, actualDuration: 3600 }];
    await assert.rejects(
        () => finalizeSidecar(
            { workDir, folderDir, primaryName: 'f-stamp.mp3', tmpName, fragments, enc },
            { fs, finalizeHour, log: { warn() {}, info() {} } },
        ),
        /ffmpeg finalise exited 1/,
    );
    // The half-written temp must have been cleaned up on the failure path.
    assert.ok(!fs.existsSync(path.join(folderDir, tmpName)), 'failed finalise must not leak a .finalize temp');
});

test('mutex-cleanup pattern: a rejecting finalise does not escape as an unhandled rejection (RC1a)', async () => {
    // Reproduce the recorder's mutex cleanup around a rejecting work promise and
    // assert NO unhandledRejection fires (the old `run.finally(cleanup)` did).
    const finalizing = new Map();
    const key = 'f/stamp';

    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
        const run = Promise.reject(new Error('boom'));
        finalizing.set(key, run);
        const cleanup = () => {
            if (finalizing.get(key) === run) {
                finalizing.delete(key);
            }
        };
        // The fixed pattern: then(cleanup, cleanup).catch(()=>{}) handles run's
        // rejection on this chain so nothing is left floating.
        run.then(cleanup, cleanup).catch(() => {});
        // The caller still sees the real rejection via its own .catch on run.
        let caught = null;
        await run.catch((e) => { caught = e; });
        assert.strictEqual(caught.message, 'boom');
        assert.strictEqual(finalizing.has(key), false, 'mutex entry cleared on reject');

        // Let any microtasks / unhandledRejection events settle.
        await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(unhandled.length, 0, 'no unhandled rejection must escape the mutex cleanup');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});

test('boot ordering: current-hour catch-up runs even if the past-hour finalise rejects, and the rejection is handled (RC4/RC1b)', async () => {
    // Model the boot IIFE ordering: runCatchup FIRST (synchronously), then
    // resumePass fired WITHOUT awaiting, with its rejection caught. Assert the
    // catch-up ran regardless and no unhandled rejection escapes.
    const events = [];
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
        const runCatchup = () => { events.push('catchup'); };
        const resumePass = async () => {
            events.push('resume-start');
            throw new Error('every past-hour finalise failed');
        };

        // The fixed boot ordering.
        runCatchup();
        resumePass().catch((err) => { events.push(`resume-caught:${err.message}`); });

        await new Promise((r) => setTimeout(r, 20));

        assert.strictEqual(events[0], 'catchup', 'current-hour catch-up must run first');
        assert.ok(events.includes('resume-start'), 'past-hour resume still attempted');
        assert.ok(
            events.some((e) => e.startsWith('resume-caught:')),
            'the past-hour finalise rejection must be handled, not fatal',
        );
        assert.strictEqual(unhandled.length, 0, 'no unhandled rejection from the boot pass');
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
});
