const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// recorder.js boots on require (opens the DB, registers cron, schedules timers)
// so it cannot be exercised as a plain unit without a full stack. The live
// logic itself is unit-tested in live-preview.test.js; this guard locks in the
// WIRING of the periodic preview tick into recorder.js: the timer must be
// registered with setInterval, .unref()'d like the other recorder timers, and
// CLEARED in shutdown() alongside newStreamPollTimer. A regression that drops
// any of these (e.g. a leaking interval on shutdown, or a missing tick) fails
// here without needing to boot the recorder.
const SRC = fs.readFileSync(path.join(__dirname, 'recorder.js'), 'utf8');

test('recorder.js imports the live-preview writer', () => {
    assert.match(SRC, /require\(['"]\.\/live-preview['"]\)/);
    assert.match(SRC, /writeLivePreview/);
});

test('recorder.js schedules the live-preview tick on a ~2.5min interval with .unref()', () => {
    assert.match(SRC, /LIVE_PREVIEW_MS\s*=\s*150000/);
    assert.match(SRC, /livePreviewTimer\s*=\s*setInterval\(livePreviewTick,\s*LIVE_PREVIEW_MS\)/);
    assert.match(SRC, /livePreviewTimer\.unref\(\)/);
});

test('shutdown() clears livePreviewTimer alongside newStreamPollTimer', () => {
    // Extract the shutdown function body and assert both timers are cleared.
    const shutdownIdx = SRC.indexOf('function shutdown(signal)');
    assert.ok(shutdownIdx >= 0, 'shutdown() must exist');
    const body = SRC.slice(shutdownIdx, shutdownIdx + 2000);
    assert.match(body, /clearInterval\(newStreamPollTimer\)/);
    assert.match(body, /clearInterval\(livePreviewTimer\)/);
    assert.match(body, /livePreviewTimer\s*=\s*null/);
});

test('the preview tick never writes the canonical primary (uses writeLivePreview only)', () => {
    // The tick body must delegate to writeLivePreview; it must not build a
    // `<folder>-<stamp>` primary path itself.
    const tickIdx = SRC.indexOf('function livePreviewTick()');
    assert.ok(tickIdx >= 0, 'livePreviewTick() must exist');
    const body = SRC.slice(tickIdx, tickIdx + 2000);
    assert.match(body, /writeLivePreview\(AUDIO_BASE/);
});
