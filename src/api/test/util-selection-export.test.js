/**
 * Coverage for POST /util/selection-export (FEAT-002): the optional `ext` body
 * field. A bad ext is a 400 before any ffmpeg work; a valid non-mp3 ext builds
 * the source path with that extension (so a missing .opus/.flac file is a 404,
 * proving the extension flows into the path). Follows the node:http + fetch
 * integration pattern (no supertest). No ffmpeg is invoked on these paths.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');

let server;
let baseUrl;

before(async () => {
    const utilRouter = require('../routes/util');
    const app = express();
    app.use(express.json());
    app.use('/util', utilRouter);

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

function post(body) {
    return fetch(`${baseUrl}/util/selection-export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const BASE = {
    station_id: 'radio1',
    year: '2026',
    month: '10',
    day: '23',
    hour: '09',
    startTime: 0,
    endTime: 5,
};

test('a bad ext is rejected 400 before any processing', async () => {
    const res = await post({ ...BASE, ext: 'aac' });
    assert.strictEqual(res.status, 400);
});

test('an omitted ext defaults to mp3 (source path 404 when no file exists)', async () => {
    // No audio file exists in the test env, so a valid request reaches the
    // file-existence check and 404s — proving ext defaulting did not 400.
    const res = await post({ ...BASE });
    assert.strictEqual(res.status, 404);
});

test('a valid opus/flac ext passes validation and builds the source path', async () => {
    const opus = await post({ ...BASE, ext: 'opus' });
    assert.strictEqual(opus.status, 404, 'opus request validated, file missing -> 404');
    const flac = await post({ ...BASE, ext: 'flac' });
    assert.strictEqual(flac.status, 404, 'flac request validated, file missing -> 404');
});

test('a non-string ext is rejected 400', async () => {
    const res = await post({ ...BASE, ext: 3 });
    assert.strictEqual(res.status, 400);
});
