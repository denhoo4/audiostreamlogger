/**
 * Regression test for the production finalise CRASH-LOOP (hotfix).
 *
 * Reproduces the EXACT production state that crash-looped the recorder:
 *   - a `.inprogress/<stamp>/` work dir with a `state.json` ledger that
 *     references a fragment file which does NOT exist on disk (the `956-0.mp3`
 *     shape), alongside one real fragment, and
 *   - a pile of empty `.finalize.*` temp files sitting in the stream folder.
 *
 * Before the hotfix, feeding the missing `956-0.mp3` straight to ffmpeg exited 1
 * ("No such file or directory") and the unhandled rejection killed the process,
 * leaking one empty `.finalize.*` per crash-loop iteration. After the hotfix the
 * finalise drives `finalizeSidecar`, which validates every fragment against the
 * disk first: a missing fragment becomes silence (timeline widens over its
 * range, hour stays 3600s), a failed finalise removes its own temp, and an
 * all-missing hour is a clean skip rather than a broken/empty file or a crash.
 *
 * We drive the REAL finalise core (`finalizeSidecar`) end to end in a throwaway
 * `fs.mkdtempSync` dir with a real ffmpeg binary — NEVER the host ./audio|./data
 * tree. Skips cleanly when ffmpeg/ffprobe are absent so the pure baseline still
 * runs on a plain node image.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { finalizeSidecar } = require('./finalize-sidecar');
const { resolveEncoding } = require('./encoding');
const { writeState } = require('./inprogress');

const TOLERANCE = 0.05; // seconds (~ one AAC frame)

function hasBinary(bin) {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    return !r.error && r.status === 0;
}

const FFMPEG_OK = hasBinary('ffmpeg') && hasBinary('ffprobe');

// Create a `seconds`-long real mp3 fragment named `name` in `dir`.
function makeMp3Fragment(dir, name, seconds) {
    const out = path.join(dir, name);
    const r = spawnSync(
        'ffmpeg',
        [
            '-y',
            '-f', 'lavfi',
            '-t', String(seconds),
            '-i', 'sine=frequency=440:sample_rate=44100',
            '-ac', '2',
            '-c:a', 'libmp3lame', '-b:a', '160k', '-ar', '44100',
            out,
        ],
        { stdio: 'ignore' },
    );
    assert.strictEqual(r.status, 0, `failed to generate fragment ${name}`);
    return out;
}

function probeDuration(file) {
    const r = spawnSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:noprint_wrappers=1', file],
        { encoding: 'utf8' },
    );
    assert.strictEqual(r.status, 0, `ffprobe failed for ${file}`);
    return parseFloat(r.stdout.trim());
}

async function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashl-missing-frag-'));
    try {
        return await fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// Build the production-shaped layout in `dir`:
//   <dir>/<folder>/                          (stream folder, holds primary + temps)
//   <dir>/<folder>/.inprogress/<stamp>/      (work dir, ffmpeg cwd)
//   <dir>/<folder>/.inprogress/<stamp>/state.json
//   <dir>/<folder>/.finalize.<...>           (pile of empty stale temps)
// Returns the paths the test needs.
function stageProduction(dir, folder, stamp, fragments, realFragmentSpecs, staleTempCount) {
    const folderDir = path.join(dir, folder);
    const workDir = path.join(folderDir, '.inprogress', stamp);
    fs.mkdirSync(workDir, { recursive: true });

    // Write the real fragments that DO exist on disk.
    for (const spec of realFragmentSpecs) {
        makeMp3Fragment(workDir, spec.file, spec.seconds);
    }

    // The state.json ledger references every fragment (including the missing one).
    writeState(workDir, { folder, stamp, ext: 'mp3', fragments });

    // A pile of empty `.finalize.*` temps, as accumulated by the old crash-loop.
    for (let i = 0; i < staleTempCount; i++) {
        fs.writeFileSync(path.join(folderDir, `.finalize.${1000 + i}.${Date.now()}.mp3`), '');
    }

    return { folderDir, workDir };
}

test('finalizeSidecar: a ledger referencing a MISSING fragment (956-0.mp3) does not crash and yields an exact 3600s hour with silence', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        const folder = 'rtv_connect';
        const stamp = '2026-11-06-22';
        // Ledger: three 1200s fragments back-to-back; the MIDDLE one (956-0.mp3)
        // is never created on disk — the production failure shape.
        const fragments = [
            { file: '0-0.mp3', startOffset: 0, actualDuration: 1200 },
            { file: '956-0.mp3', startOffset: 1200, actualDuration: 1200 },
            { file: '2400-0.mp3', startOffset: 2400, actualDuration: 1200 },
        ];
        const { folderDir, workDir } = stageProduction(
            dir,
            folder,
            stamp,
            fragments,
            // Only the first and last fragments exist on disk; 956-0.mp3 does not.
            [{ file: '0-0.mp3', seconds: 2 }, { file: '2400-0.mp3', seconds: 2 }],
            5, // five empty stale .finalize temps
        );

        const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160 });
        const tmpName = `.finalize.${process.pid}.${Date.now()}.mp3`;

        // (a) finalise must RESOLVE, never throw/reject.
        const status = await finalizeSidecar(
            { workDir, folderDir, primaryName: `${folder}-${stamp}.mp3`, tmpName, fragments, enc },
            { fs },
        );

        assert.strictEqual(status.finalized, true, 'finalise must succeed, not throw');
        // (c) a correct 3600s file exists with silence where 956-0.mp3 was.
        const primary = path.join(folderDir, `${folder}-${stamp}.mp3`);
        assert.ok(fs.existsSync(primary), 'primary hour file must exist');
        const dur = probeDuration(primary);
        assert.ok(Math.abs(dur - 3600) <= TOLERANCE, `hour duration ${dur} != 3600`);
        // The dropped fragment's 1200s offset range became part of the silence.
        assert.ok(status.gapSeconds >= 1200, `gap (${status.gapSeconds}s) must cover the missing fragment range`);
        // The temp was renamed onto the primary; no stray tmpName left behind.
        assert.ok(!fs.existsSync(path.join(folderDir, tmpName)), 'finalise temp must be renamed/removed');
    });
});

test('finalizeSidecar: ALL fragments missing -> no broken/empty output, clean skip, no throw', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        const folder = 'rtv_connect';
        const stamp = '2026-11-06-21';
        const fragments = [
            { file: '0-0.mp3', startOffset: 0, actualDuration: 1800 },
            { file: '956-0.mp3', startOffset: 1800, actualDuration: 1800 },
        ];
        // Stage with NO real fragments on disk.
        const { folderDir, workDir } = stageProduction(dir, folder, stamp, fragments, [], 3);

        const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160 });
        const tmpName = `.finalize.${process.pid}.${Date.now()}.mp3`;

        const status = await finalizeSidecar(
            { workDir, folderDir, primaryName: `${folder}-${stamp}.mp3`, tmpName, fragments, enc },
            { fs },
        );

        assert.strictEqual(status.finalized, false);
        assert.strictEqual(status.reason, 'no-usable-fragments');
        // No broken/empty primary file produced.
        assert.ok(!fs.existsSync(path.join(folderDir, `${folder}-${stamp}.mp3`)), 'no primary file must be written');
        // No new finalise temp leaked for this hour.
        assert.ok(!fs.existsSync(path.join(folderDir, tmpName)), 'no finalise temp must be written');
    });
});

test('finalizeSidecar: a zero-byte fragment in the middle becomes silence and the mp3 hour stays exactly 3600s', { skip: !FFMPEG_OK }, async () => {
    await withTempDir(async (dir) => {
        const folder = 'joe_nl';
        const stamp = '2026-11-06-20';
        const fragments = [
            { file: '0-0.mp3', startOffset: 0, actualDuration: 1200 },
            { file: '1200-0.mp3', startOffset: 1200, actualDuration: 1200 }, // will be zero-byte
            { file: '2400-0.mp3', startOffset: 2400, actualDuration: 1200 },
        ];
        const { folderDir, workDir } = stageProduction(
            dir,
            folder,
            stamp,
            fragments,
            [{ file: '0-0.mp3', seconds: 2 }, { file: '2400-0.mp3', seconds: 2 }],
            0,
        );
        // Create the middle fragment as an EMPTY (zero-byte) file on disk.
        fs.writeFileSync(path.join(workDir, '1200-0.mp3'), '');

        const enc = resolveEncoding({ codec: 'mp3', bitrate_kbps: 160 });
        const tmpName = `.finalize.${process.pid}.${Date.now()}.mp3`;

        const status = await finalizeSidecar(
            { workDir, folderDir, primaryName: `${folder}-${stamp}.mp3`, tmpName, fragments, enc },
            { fs },
        );

        assert.strictEqual(status.finalized, true);
        const primary = path.join(folderDir, `${folder}-${stamp}.mp3`);
        const dur = probeDuration(primary);
        assert.ok(Math.abs(dur - 3600) <= TOLERANCE, `hour duration ${dur} != 3600`);
        assert.strictEqual(status.fragments, 2, 'zero-byte fragment must be dropped');
    });
});
