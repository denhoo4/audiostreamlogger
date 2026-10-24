/**
 * REAL destructive fs smoke for the stream-folder lifecycle service (TODO 25/26).
 *
 * Runs the ACTUAL delete + rename (incl. a NUMERIC folder) against a THROWAWAY
 * temp dir pointed at by AUDIO_DIR — NEVER repo-root ./audio. Creates fake
 * audio/<folder>/ dirs with recordings + .json peaks, then:
 *   1) delete  -> folder + rows gone
 *   2) rename  -> files under the new folder, old gone, rows re-pointed with
 *                 intact YYYY-MM-DD-HH stamps (numeric folder 100nl -> z100)
 *
 * Not part of `node --test`; run manually inside node:26-bookworm:
 *   node scripts/lifecycle-smoke.js
 * Exits non-zero on any assertion failure.
 */
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-lifecycle-smoke-'));
const audioDir = path.join(rootTmp, 'audio');
fs.mkdirSync(audioDir, { recursive: true });
process.env.AUDIO_DIR = audioDir;

// Safety assertion: never operate on the repo-root ./audio.
assert.ok(
    audioDir.startsWith(os.tmpdir()),
    `refusing to smoke outside the temp dir: ${audioDir}`
);

const dbPath = path.join(rootTmp, 'app.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = DELETE');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA foreign_keys = ON');

// Inject the temp handle for the service's module-level require('../db').
const dbModulePath = require.resolve('../db');
require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: db,
};

const { applySchema } = require('../db/schema');
applySchema(db);
const lifecycle = require('../services/stream-lifecycle');

function log(msg) {
    // eslint-disable-next-line no-console
    console.log(msg);
}

function insertStream(folder) {
    const r = db
        .prepare(
            "INSERT INTO streams (country, name, folder, url, codec) VALUES ('NL', ?, ?, 'https://e/x', 'mp3')"
        )
        .run(folder, folder);
    return Number(r.lastInsertRowid);
}

function writeRec(folder, date, hour, bytes = 1234) {
    const dir = path.join(audioDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${folder}-${date}-${hour}.mp3`), Buffer.alloc(bytes, 1));
    fs.writeFileSync(path.join(dir, `${folder}-${date}-${hour}.json`), JSON.stringify({ data: [0] }));
    db.prepare(
        `INSERT INTO recordings (stream_folder, date, hour, file_path, status, size_bytes, segment_count)
         VALUES (?, ?, ?, ?, 'complete', ?, 1)`
    ).run(folder, date, hour, path.join(dir, `${folder}-${date}-${hour}.mp3`), bytes);
}

log(`SMOKE audioDir = ${audioDir}`);

/* --- 1) DELETE --- */
const delId = insertStream('radio_smoke');
writeRec('radio_smoke', '2026-10-23', '09');
writeRec('radio_smoke', '2026-10-23', '10');
const impact = lifecycle.deletionImpact('radio_smoke');
log(`DELETE impact: ${impact.fileCount} files, ${impact.totalBytes} bytes`);
assert.strictEqual(impact.fileCount, 4); // 2 mp3 + 2 json
const delRes = lifecycle.deleteStreamWithFolder(delId, { db });
assert.strictEqual(delRes.removed, true);
assert.strictEqual(delRes.fsError, null);
assert.strictEqual(fs.existsSync(path.join(audioDir, 'radio_smoke')), false);
assert.strictEqual(
    db.prepare("SELECT COUNT(*) c FROM recordings WHERE stream_folder='radio_smoke'").get().c,
    0
);
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM streams').get().c, 0);
log('DELETE ok: folder + rows gone');

/* --- 2) RENAME (numeric folder) --- */
insertStream('100nl');
writeRec('100nl', '2026-01-09', '10');
writeRec('100nl', '2026-01-09', '11');
const renRes = lifecycle.renameStreamFolder('100nl', 'z100', { db });
log(`RENAME 100nl -> z100: ${renRes.rowsRepointed} rows re-pointed, files [${renRes.movedFiles.join(', ')}]`);
assert.strictEqual(fs.existsSync(path.join(audioDir, '100nl')), false);
assert.ok(fs.existsSync(path.join(audioDir, 'z100', 'z100-2026-01-09-10.mp3')));
assert.ok(fs.existsSync(path.join(audioDir, 'z100', 'z100-2026-01-09-10.json')));
const rows = db.prepare('SELECT stream_folder, date, hour, file_path FROM recordings ORDER BY hour').all();
for (const row of rows) {
    assert.strictEqual(row.stream_folder, 'z100');
    const expected = path.join(audioDir, 'z100', `z100-${row.date}-${row.hour}.mp3`);
    assert.strictEqual(row.file_path, expected, `stamp intact for ${row.hour}`);
    log(`  row ${row.hour}: ${row.file_path}`);
}
log('RENAME ok: files moved + renamed, rows re-pointed, date stamps intact');

db.close();
fs.rmSync(rootTmp, { recursive: true, force: true });
log('SMOKE PASSED — throwaway dir cleaned up');
