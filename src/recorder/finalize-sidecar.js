/**
 * Testable per-hour finalise core (hotfix).
 *
 * This is the real work `recorder.js`'s `finalizeIfNeeded` performs once the
 * mutex, folder-containment guard and the "already finalised / no sidecar"
 * short-circuits have been applied: validate the sidecar fragments against the
 * disk, lay the survivors on the 3600s timeline, run ffmpeg to a TEMP name, and
 * atomic-rename onto the primary on success. It is a thin orchestration over the
 * pure `filterUsableFragments` + `buildTimeline` helpers and the `finalizeHour`
 * ffmpeg runner, with its fs surface injectable so it can be exercised end to
 * end in a throwaway temp dir (reproducing the production `.inprogress/<stamp>/`
 * + missing `956-0.mp3` state WITHOUT booting the whole recorder module, which
 * opens the DB and schedules cron on require).
 *
 * Fail-safe contract (hotfix RC2/RC3):
 *   - A fragment whose file is missing / zero-byte / unreadable is DROPPED and
 *     logged; buildTimeline widens the surrounding silence over its offset range
 *     so the hour stays exactly 3600s.
 *   - If NO fragment survives, it does NOT emit a broken/empty file and does NOT
 *     throw: it returns { finalized:false, reason:'no-usable-fragments' } so the
 *     caller can clean up the orphaned work dir.
 *   - On a finalise error it removes the half-written temp and re-throws so the
 *     caller's mutex .catch logs it (and the cron/boot backstop can retry the
 *     still-present work dir); it never leaves a stray `.finalize.*` behind on
 *     the failure path.
 */

const nodeFs = require('fs');
const path = require('path');
const { buildTimeline, filterUsableFragments } = require('./finalize-timeline');
const { finalizeHour } = require('./finalize-hour');

/**
 * @param {object} args
 * @param {string} args.workDir      the `.inprogress/<stamp>` dir (ffmpeg cwd).
 * @param {string} args.folderDir    the stream folder dir (where the primary + temp live).
 * @param {string} args.primaryName  final file name `<folder>-<stamp>.<ext>`.
 * @param {string} args.tmpName      temp file name `.finalize.<pid>.<ts>.<ext>`.
 * @param {Array}  args.fragments    the sidecar `state.fragments` list.
 * @param {object} args.enc          resolved encoding.
 * @param {object} [deps]            injectable seams (default: real fs/finalizeHour/console).
 * @returns {Promise<object>} status: { finalized, reason?, primaryPath?, fragments?, gapSeconds?, segments? }
 */
async function finalizeSidecar(args, deps = {}) {
    const fs = deps.fs || nodeFs;
    const runFinalize = deps.finalizeHour || finalizeHour;
    const log = deps.log || console;

    const { workDir, folderDir, primaryName, tmpName, fragments, enc } = args;
    const primaryPath = path.join(folderDir, primaryName);
    const tmpPath = path.join(folderDir, tmpName);

    const rawFragments = (Array.isArray(fragments) ? fragments : []).map((f) => ({
        startOffset: f.startOffset,
        actualDuration: f.actualDuration,
        plannedDuration: f.plannedDuration,
        file: f.file,
        ext: f.ext,
    }));

    // Validate each fragment against the disk (hotfix RC2). fragment.file is a
    // basename inside workDir (the ffmpeg cwd), so resolve the predicate there.
    const existsAndNonEmpty = (file) => {
        try {
            return fs.statSync(path.join(workDir, file)).size > 0;
        } catch {
            return false;
        }
    };
    const usableFragments = filterUsableFragments(rawFragments, existsAndNonEmpty);

    if (usableFragments.length < rawFragments.length) {
        for (const f of rawFragments) {
            if (!usableFragments.includes(f)) {
                (log.warn || log.error || log.log).call(
                    log,
                    `recorder: dropping missing/empty fragment ${JSON.stringify(f.file)} at offset ${f.startOffset}s for ${primaryName} (treated as silence).`,
                );
            }
        }
    }

    // Nothing usable -> do not emit a broken/empty hour, do not throw.
    if (usableFragments.length === 0) {
        return { finalized: false, reason: 'no-usable-fragments' };
    }

    const segments = buildTimeline(usableFragments);

    try {
        const result = await runFinalize(workDir, tmpPath, enc, { segments });
        fs.renameSync(tmpPath, primaryPath);
        (log.info || log.log).call(
            log,
            `recorder: finalised ${primaryName} (${result.mode}) from ${usableFragments.length} fragment(s).`,
        );
    } catch (err) {
        // Remove the half-written temp so a failed finalise never leaks a
        // `.finalize.*` (hotfix RC3); re-throw so the caller can log + retry.
        try {
            if (fs.existsSync(tmpPath)) {
                fs.rmSync(tmpPath, { force: true });
            }
        } catch { /* ignore */ }
        throw err;
    }

    let sizeBytes = null;
    try {
        sizeBytes = fs.statSync(primaryPath).size;
    } catch { /* best-effort size */ }

    const gapSeconds = Math.round(
        segments
            .filter((s) => s.kind === 'silence')
            .reduce((sum, s) => sum + (Number(s.durationSeconds) || 0), 0),
    );

    return {
        finalized: true,
        primaryPath,
        fragments: usableFragments.length,
        sizeBytes,
        gapSeconds,
        segments,
    };
}

module.exports = { finalizeSidecar };
