const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const { shutdownWorker } = require('../worker');

// shutdownWorker mirrors the recorder's shutdown(): an idempotent `shuttingDown`
// guard, every timer cleared behind an `if (t)` guard (so a double signal or an
// already-null handle never throws), the RW handle closed inside a try/catch
// (so an already-closed handle is safe), then process.exit(0). start() is
// deliberately NOT called here — it opens the real DB path and registers
// process-wide signal handlers. The module-level timer handles are null until
// start() runs, which is the safe double-signal / not-yet-started case the
// `if (t)` guards must tolerate.
//
// NOTE: `shuttingDown` is a module-level latch, so the FIRST shutdownWorker call
// in this process runs the full path and the rest short-circuit. The tests are
// ordered to assert the full path once, then the idempotent no-op.

const realExit = process.exit;
afterEach(() => {
    process.exit = realExit;
});

test('full shutdown path: clears (null) timers, closes handle via guarded catch, exits 0', () => {
    // A fake handle whose close() throws proves the db.close() try/catch swallows
    // an already-closed / failing handle. The null module-level timer handles
    // prove the `if (t)` clear guards tolerate not-yet-started timers. This is
    // the first call, so it runs the full body.
    let closed = false;
    const fakeDb = {
        close() {
            closed = true;
            throw new Error('database handle is already closed');
        },
    };

    let exitCode = 'unset';
    process.exit = (code) => {
        exitCode = code;
    };

    assert.doesNotThrow(() => shutdownWorker(fakeDb, 'SIGTERM'));
    assert.strictEqual(closed, true, 'reached the guarded db.close()');
    assert.strictEqual(exitCode, 0, 'exits 0 even though close() threw');
});

test('a second signal is an idempotent no-op and does not throw', () => {
    // `shuttingDown` latched above, so this call returns immediately: it must not
    // touch the handle and must not call process.exit again.
    let closed = false;
    const fakeDb = {
        close() {
            closed = true;
        },
    };

    let exited = false;
    process.exit = () => {
        exited = true;
    };

    assert.doesNotThrow(() => shutdownWorker(fakeDb, 'SIGINT'));
    assert.strictEqual(closed, false, 'guard short-circuits before db.close()');
    assert.strictEqual(exited, false, 'guard short-circuits before process.exit');
});
