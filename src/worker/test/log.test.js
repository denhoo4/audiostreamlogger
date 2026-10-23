const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const log = require('../log');

// One test on the worker copy is sufficient — src/api/lib/log.js and
// src/recorder/log.js are byte-identical copies of this helper.

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
};

afterEach(() => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
});

function capture(method, run) {
    const calls = [];
    console[method] = (...args) => calls.push(args);
    run();
    return calls;
}

test('info emits one line starting with an ISO timestamp + INFO and the message', () => {
    const calls = capture('log', () => log.info('hello world'));
    assert.strictEqual(calls.length, 1);
    const [prefix, message] = calls[0];
    assert.match(prefix, ISO_PREFIX);
    assert.match(prefix, /INFO/);
    assert.strictEqual(message, 'hello world');
});

test('warn emits via console.warn with a WARN token', () => {
    const calls = capture('warn', () => log.warn('careful'));
    assert.strictEqual(calls.length, 1);
    const [prefix, message] = calls[0];
    assert.match(prefix, ISO_PREFIX);
    assert.match(prefix, /WARN/);
    assert.strictEqual(message, 'careful');
});

test('error emits via console.error with an ERROR token and preserves extra args', () => {
    const err = new Error('boom');
    const calls = capture('error', () => log.error('failed:', err));
    assert.strictEqual(calls.length, 1);
    const [prefix, message, passedErr] = calls[0];
    assert.match(prefix, ISO_PREFIX);
    assert.match(prefix, /ERROR/);
    assert.strictEqual(message, 'failed:');
    assert.strictEqual(passedErr, err);
});
