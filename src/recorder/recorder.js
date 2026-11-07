const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cron = require('node-cron');
const log = require('./log');
const { secondsUntilNextHour, elapsedThisHour, currentHourStamp } = require('./time-helpers');
const { readStreams, readRecorderMinute } = require('./streams-db');
const { backoffDelayMs, shouldRestartWithinHour } = require('./backoff-helpers');
const { isValidFolder, isContainedPath } = require('./folder-utils');
const { streamsNeedingCatchup, currentHourDecision } = require('./catchup-helpers');
const recordingsDb = require('./recordings-db');
const { resolveEncoding, outputOptionsFor, copyOutputOptions } = require('./encoding');
const { detectSource, isCopyEligible } = require('./detect-source');
const { finalizeSidecar } = require('./finalize-sidecar');
const {
    inprogressDir,
    fragmentName,
    readState,
    writeState,
} = require('./inprogress');
const { buildTimeline } = require('./finalize-timeline');
const { finalizeHour } = require('./finalize-hour');
const { writeLivePreview } = require('./live-preview');

// Last-resort process-level safety net (hotfix RC1b). The real fix for the
// crash-loop is the fail-safe finalise call sites + handled mutex cleanup, but
// a single stray async rejection (from ANY future call site) must never be able
// to kill the recorder: a dead recorder records nothing for every stream. These
// handlers LOG a loud, greppable line (so the underlying bug is still findable
// in prod) and DELIBERATELY DO NOT call process.exit — the recorder keeps
// running and the cron schedule keeps firing. Registered at module top, before
// the boot IIFE, so they are active for the very first boot resume pass.
process.on('unhandledRejection', (reason) => {
    const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
    log.error('recorder: UNHANDLED REJECTION (kept running, not fatal):', detail);
});
process.on('uncaughtException', (err) => {
    const detail = err instanceof Error ? (err.stack || err.message) : String(err);
    log.error('recorder: UNCAUGHT EXCEPTION (kept running, not fatal):', detail);
});

// The on-disk root under which every stream's audio folder lives. Defined once
// so the folder-containment guard (folder-utils.isContainedPath) checks against
// the same base the path-build sites interpolate `folder` into.
const AUDIO_BASE = path.join(__dirname, 'audio');

// The recorder's OWN scoped read-write DB handle (FEAT-002), opened once at
// module load like streams-db is used per-read. recordings writes go through it
// so the recorder can track each hour's row (status recording->partial/complete
// + size_bytes). The open is wrapped so a not-ready DB at boot only logs and
// leaves `recordingsHandle` null — every recordings write below is best-effort
// and no-ops on a null handle, never crashing the recorder or disturbing ffmpeg.
let recordingsHandle = null;
try {
    recordingsHandle = recordingsDb.openDb();
} catch (err) {
    log.error('recorder: recordings DB not ready at boot, recordings rows disabled until restart:', err.message);
}

// Best-effort recordings writers: each swallows a null handle and any error with
// a greppable log line so a DB hiccup never throws into the ffmpeg callbacks.
function recordStartRow(folder, stamp, ext = 'mp3') {
    if (!recordingsHandle) {
        return;
    }
    try {
        recordingsDb.upsertRecordingStart(recordingsHandle, { folder, stamp, ext });
    } catch (err) {
        log.error(`recorder: recordings start-row write failed for ${folder} ${stamp}:`, err.message);
    }
}

function recordCompleteRow(folder, stamp, sizeBytes, gapSeconds) {
    if (!recordingsHandle) {
        return;
    }
    try {
        recordingsDb.markComplete(recordingsHandle, {
            folder,
            stamp,
            sizeBytes,
            gapSeconds,
            hasSilence: Number.isFinite(gapSeconds) && gapSeconds > 0,
        });
    } catch (err) {
        log.error(`recorder: recordings complete-row write failed for ${folder} ${stamp}:`, err.message);
    }
}

// Heartbeat file touched at boot and on every tick; the compose healthcheck
// checks its freshness to detect a worker that has silently stopped ticking.
const HEARTBEAT = '/tmp/heartbeat';
function writeHeartbeat() {
    try {
        fs.writeFileSync(HEARTBEAT, new Date().toISOString());
    } catch (err) {
        log.error('recorder: failed to write heartbeat:', err);
    }
}

// --- Per-stream supervision tuning (deliverable 1) --------------------------
// Capped exponential backoff between restart attempts of a SINGLE stream whose
// ffmpeg died/errored mid-hour. Growth and cap keep a persistently failing
// stream retrying without ever spinning hot. RESTART_FLOOR_SECONDS is the small
// floor below which we stop scheduling mid-hour restarts: when that little time
// is left the next hourly cron tick is about to start a fresh set of
// recordings, so handing back to the normal per-hour logic is correct.
const BACKOFF_BASE_MS = 2000;      // first restart waits ~2s
const BACKOFF_CAP_MS = 60000;      // never wait more than ~60s between retries
const RESTART_FLOOR_SECONDS = 30;  // stop restarting in the last 30s of the hour

// Registry of the ffmpeg commands we are currently supervising, keyed by a
// unique supervision id. Used by the graceful-shutdown handler (deliverable 2)
// to SIGTERM every in-progress recording so each mp3 is finalized, not
// truncated. Also lets us distinguish an intentional stop (shutdown / duration
// reached) from an unexpected failure that warrants a restart (D4).
const active = new Map();
let nextSupervisionId = 1;

// Set true by the shutdown handler so no supervisor schedules a new restart
// while we are tearing down.
let shuttingDown = false;

// The recorder schedule minute now comes from the shared DB (app_config), not
// settings.json. readRecorderMinute() returns a validated 0..59 integer and
// falls back to 0 (never process.exit) when the DB is not ready. It is a
// reassignable `let` so the re-read timer below can hot-reschedule the cron
// task when the minute changes without a full container restart.
let currentMinute = readRecorderMinute();

// Build and start an ffmpeg recording command for one stream and RETURN the
// command object so the supervisor can observe its error/end events and kill it
// on shutdown. The per-stream codec/bitrate/bit_depth (on the full `item` row)
// is resolved via encoding.js into the ffmpeg OUTPUT option ARRAY (never a shell
// string — NFR-3) and the output-file extension; for the behaviour-preserving
// default row (mp3@160) this is exactly today's `-c:a libmp3lame -b:a 160k
// -ar 44100`. Capture writes an offset-named FRAGMENT into the hidden per-hour
// work dir (FEAT-002): `.inprogress/<stamp>/<startOffset>-<attempt>.<ext>`.
// `startOffset` (seconds into the hour) places the fragment on the 3600s
// timeline; `attempt` disambiguates two fragments at the same offset. The
// primary `<folder>-<stamp>.<ext>` is written only by finalizeIfNeeded later,
// never by capture. An unrecognised/NULL codec clamps to mp3 defensively and
// logs a greppable warn.
//
// `detected` (4th param, the { codec, formatName }|null resolved by
// detectSource) selects the COPY path: when the detected source codec matches
// this stream's resolved codec AND the container is copy-eligible (mp3/mp3,
// aac/adts), the source is stream-copied untouched (no re-encode, no resample —
// so the `.audioFrequency(44100)` call is DROPPED and copyOutputOptions is used,
// ignoring the configured bitrate). Otherwise the full transcode path (today's
// behaviour) runs: `.audioFrequency(44100).outputOptions(outputOptionsFor(enc))`.
// This function STAYS SYNCHRONOUS — the async probe happens in superviseStream,
// which passes the already-resolved `detected` in.
function recordStream(item, durationSeconds = 3600, attempt = 0, detected = null, startOffset = 0, stamp = null) {
    const { name, folder, url } = item;
    if (!isValidFolder(folder) || !isContainedPath(AUDIO_BASE, folder)) {
        log.error(`recorder: skipping stream ${name}: invalid folder ${JSON.stringify(folder)}`);
        return;
    }
    const enc = resolveEncoding(item);
    if (enc.clamped && typeof item.codec !== 'undefined' && item.codec !== null) {
        log.error(`recorder: unknown codec ${item.codec} for ${folder}, falling back to mp3`);
    }

    const copy = isCopyEligible(enc.codec, detected);

    // Capture now routes through the hidden per-hour work dir (FEAT-002):
    // audio/<folder>/.inprogress/<stamp>/<startOffset>-<attempt>.<ext>. The
    // primary <folder>-<stamp>.<ext> is written only by finalizeIfNeeded later,
    // never by capture. mkdir the work dir (recursive also creates the folder).
    const formattedDate = stamp || currentHourStamp();
    const workDir = inprogressDir(AUDIO_BASE, folder, formattedDate);
    fs.mkdirSync(workDir, { recursive: true });

    const outputPath = path.join(workDir, fragmentName(startOffset, attempt, enc.ext));

    if (copy) {
        log.info(`recorder: source for ${name} (folder ${folder}) matches configured ${enc.codec} (container ${detected.formatName}); stream-copying without re-encode.`);
    }

    let command = ffmpeg()
        .input(url)
        .inputOptions('-user_agent', `'${name} Logger'`)
        .duration(durationSeconds);
    // Copy path: preserve the source bytes — NO resample (drop audioFrequency).
    if (!copy) {
        command = command.audioFrequency(44100);
    }
    command = command
        .outputOptions(copy ? copyOutputOptions(enc) : outputOptionsFor(enc))
        .output(outputPath)
        .on('start', (commandLine) => {
            log.info(`Started recording for ${name} in folder ${folder}.`);
        })
        .on('error', (err) => {
            log.error(`Error: ${err.message}`);
        })
        .on('end', () => {
            log.info(`Recording finished for ${name} in folder ${folder}`);
        });

    command.run();
    return command;
}

// Supervise one stream's recording for the remainder of the current hour.
// Starts the ffmpeg command for this `attempt`, registers it so shutdown can
// finalize it, and watches for an UNEXPECTED error/early end. On an unexpected
// failure it logs a greppable per-stream line and, if time still remains in the
// hour and we are not shutting down, schedules a single restart after a capped
// exponential backoff. Each stream is supervised independently: one stream's
// failure never kills or disturbs another stream's recording (deliverable 1).
//
// rev-3 async wiring: before starting ffmpeg we probe the source codec (bounded
// <=8s via detectSource) to decide copy-vs-transcode. To tolerate a SIGTERM
// that arrives DURING that probe window, the supervision entry is registered in
// `active` IMMEDIATELY with a null command (the shutdown loop skips null-command
// entries), and `shuttingDown` is re-checked AFTER the await before any ffmpeg
// is started. detectSource NEVER rejects (resolves null -> transcode), so the
// probe can only delay, never fail, the start of a recording. The function is
// async; every caller wraps the returned promise in `.catch` so a rejection can
// never surface as an unhandled rejection.
async function superviseStream(item, attempt) {
    if (shuttingDown) {
        return;
    }

    if (!isValidFolder(item.folder) || !isContainedPath(AUDIO_BASE, item.folder)) {
        log.error(`recorder: skipping stream ${item.name}: invalid folder ${JSON.stringify(item.folder)}`);
        return;
    }

    const remaining = secondsUntilNextHour();
    const id = nextSupervisionId++;
    // `settled` guards against acting twice if ffmpeg emits both error and end.
    let settled = false;
    // Marks a command we deliberately stop (shutdown kill) so the ensuing
    // error/end is treated as expected and does NOT trigger a restart (D4).
    const entry = { command: null, item, intentionalStop: false };

    // Register the entry BEFORE awaiting the source probe. The command is still
    // null here; shutdown()'s loop skips null-command entries, so a SIGTERM that
    // lands during the probe window cannot crash on a missing command — it just
    // flips shuttingDown, which we re-check right after the await.
    active.set(id, entry);

    // The hour stamp for this supervision, captured once so the sidecar and the
    // recordings-row writes (FEAT-002) key on the same hour.
    const stamp = currentHourStamp();
    const enc = resolveEncoding(item);
    const workDir = inprogressDir(AUDIO_BASE, item.folder, stamp);

    // Probe the source codec to decide copy-vs-transcode (resolves null on any
    // failure -> transcode). Bounded by detectSource's own ~8s timeout.
    const detected = await detectSource(item.url);

    // A SIGTERM may have arrived during the probe. If we are now shutting down,
    // drop the command-less entry and bail WITHOUT starting ffmpeg.
    if (shuttingDown) {
        active.delete(id);
        return;
    }

    // Track the hour row: attempt 0 inserts a 'recording' row on start (with the
    // resolved codec extension so file_path matches the primary name finalise
    // will write). A mid-hour restart (attempt >= 1) no longer flips the row to
    // 'partial' — capture leaves the row 'recording' and finalise decides the
    // final status (FEAT-002; the gap flag lands in FEAT-004). Best-effort.
    if (attempt === 0) {
        recordStartRow(item.folder, stamp, enc.ext);
    }

    // startOffset = seconds elapsed into the hour, captured JUST BEFORE ffmpeg
    // starts so this fragment lands at the right place on the 3600s timeline.
    // A fresh attempt 0 at the top of the hour is 0; a mid-hour restart/resume
    // appends its fragment at the current offset and the [lastClosed..now] gap
    // finalises to silence.
    const startOffset = elapsedThisHour();
    const copyEligible = isCopyEligible(enc.codec, detected);
    const fragFile = fragmentName(startOffset, attempt, enc.ext);

    // Append an 'open' fragment to the per-hour sidecar before starting ffmpeg.
    // recordStream mkdirs the work dir; mkdir here too so the sidecar write that
    // precedes the ffmpeg start never races a missing dir. Best-effort: a
    // sidecar write failure only logs and never throws into the supervisor (the
    // cron/boot backstop still finalises whatever fragments do land on disk).
    try {
        fs.mkdirSync(workDir, { recursive: true });
        const state = readState(workDir) || {
            folder: item.folder,
            stamp,
            ext: enc.ext,
            copyEligible,
            fragments: [],
        };
        state.ext = enc.ext;
        state.copyEligible = copyEligible;
        state.fragments.push({
            file: fragFile,
            startOffset,
            plannedDuration: remaining,
            attempt,
            status: 'open',
        });
        writeState(workDir, state);
    } catch (err) {
        log.error(`recorder: sidecar start write failed for ${item.folder} ${stamp}:`, err.message);
    }

    // Wall-clock start so the fragment's actualDuration can be measured when
    // ffmpeg ends/errors (the capture may stop short of `remaining`).
    const startedAtMs = Date.now();

    // Flip this fragment's sidecar entry to 'closed' with the observed duration.
    // Best-effort and idempotent per fragment. Returns nothing.
    const closeFragment = () => {
        try {
            const state = readState(workDir);
            if (!state) {
                return;
            }
            const actualDuration = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
            const frag = state.fragments.find(
                (f) => f && f.file === fragFile && f.status !== 'closed',
            );
            if (frag) {
                frag.status = 'closed';
                frag.actualDuration = actualDuration;
                writeState(workDir, state);
            }
        } catch (err) {
            log.error(`recorder: sidecar close write failed for ${item.folder} ${stamp}:`, err.message);
        }
    };

    const command = recordStream(item, remaining, attempt, detected, startOffset, stamp);
    entry.command = command;

    const cleanup = () => {
        active.delete(id);
    };

    const scheduleRestart = (reason) => {
        if (settled) {
            return;
        }
        settled = true;
        cleanup();
        // Whatever happened, this fragment is no longer being written — close it
        // in the sidecar so finalise/resume see its true captured length.
        closeFragment();

        if (entry.intentionalStop) {
            // We killed it on purpose (shutdown) — not a failure, never restart.
            log.info(`recorder: ffmpeg for ${item.name} (folder ${item.folder}) stopped intentionally (${reason}); not restarting.`);
            return;
        }
        if (shuttingDown) {
            log.info(`recorder: ffmpeg for ${item.name} (folder ${item.folder}) ended during shutdown (${reason}); not restarting.`);
            return;
        }

        const remainingNow = secondsUntilNextHour();
        if (!shouldRestartWithinHour(remainingNow, RESTART_FLOOR_SECONDS)) {
            log.error(`recorder: ffmpeg for ${item.name} (folder ${item.folder}) failed (${reason}); giving up for this hour, only ${remainingNow}s left — next hourly run takes over.`);
            // No more restarts this hour and the hour is about to roll over; the
            // cron/boot backstop finalises this .inprogress hour once it is past.
            return;
        }

        const delay = backoffDelayMs(attempt, { baseMs: BACKOFF_BASE_MS, capMs: BACKOFF_CAP_MS });
        log.error(`recorder: ffmpeg for ${item.name} (folder ${item.folder}) failed (${reason}) on attempt ${attempt}; scheduling restart in ${delay}ms (${remainingNow}s left this hour).`);
        // superviseStream is async (rev-3); wrap the restart in .catch so a
        // rejected supervise can never become an unhandled rejection.
        setTimeout(() => {
            superviseStream(item, attempt + 1).catch((err) => {
                log.error(`recorder: restart supervise for ${item.folder} failed:`, err);
            });
        }, delay).unref();
    };

    command.on('error', (err) => {
        // An error while intentionally stopping is expected (SIGTERM during
        // shutdown surfaces as an ffmpeg error); scheduleRestart handles that.
        scheduleRestart(`error: ${err.message}`);
    });

    command.on('end', () => {
        if (settled) {
            return;
        }
        // A normal end after the full duration is the expected completion of
        // this hour's recording — deregister without restarting.
        settled = true;
        cleanup();
        // Close the fragment either way so the sidecar reflects its true length.
        closeFragment();
        if (entry.intentionalStop) {
            log.info(`recorder: ffmpeg for ${item.name} (folder ${item.folder}) finalized during shutdown.`);
            return;
        }
        if (shuttingDown) {
            return;
        }
        // Normal end = this hour's last fragment finished. Lay the fragments on
        // the 3600s timeline and write the single primary file (FEAT-002). The
        // finalise is IDEMPOTENT and mutex-guarded so the cron backstop can
        // never double-run it. Best-effort: a finalise error only logs and the
        // cron/boot backstop retries the still-present .inprogress dir.
        finalizeIfNeeded(AUDIO_BASE, item.folder, stamp, enc).catch((err) => {
            log.error(`recorder: finalise after ffmpeg end failed for ${item.folder} ${stamp}:`, err.message);
        });
    });

    return id;
}

// --- Idempotent per-hour finalise (FEAT-002) --------------------------------
// Per-(folder,stamp) finalise mutex: a map of in-flight finalise promises keyed
// by `${folder}/${stamp}`. ffmpeg-end and the cron backstop (and the boot
// resume pass) can all race to finalise the same hour; the mutex guarantees
// only ONE finalise runs per hour — a concurrent caller awaits the same promise
// instead of spawning a second ffmpeg that would clobber the output.
const finalizing = new Map();

// Lay a captured hour's fragments on the 3600s timeline and write the single
// primary file <folder>-<stamp>.<ext>. IDEMPOTENT and "only when needed":
//   - no sidecar (nothing captured)                      -> no-op
//   - primary file already present (already finalised)   -> no-op
//   - otherwise: buildTimeline(state.fragments) -> finalizeHour() to a TEMP
//     name in the folder, atomic-rename into place, then rm -rf the
//     .inprogress/<stamp> work dir.
// Guarded by the per-(folder,stamp) mutex so ffmpeg-end + cron can never
// double-run. Returns a promise resolving to a small status object.
function finalizeIfNeeded(audioBase, folder, stamp, enc) {
    const key = `${folder}/${stamp}`;
    const existing = finalizing.get(key);
    if (existing) {
        return existing;
    }

    const run = (async () => {
        if (!isValidFolder(folder) || !isContainedPath(audioBase, folder)) {
            log.error(`recorder: refusing to finalise invalid folder ${JSON.stringify(folder)}`);
            return { finalized: false, reason: 'invalid-folder' };
        }

        const workDir = inprogressDir(audioBase, folder, stamp);
        const state = readState(workDir);
        if (!state) {
            // No sidecar -> nothing was captured for this hour. Nothing to do;
            // also clean up an empty/stale .inprogress/<stamp> dir if present.
            try {
                if (fs.existsSync(workDir)) {
                    fs.rmSync(workDir, { recursive: true, force: true });
                }
            } catch (err) {
                log.error(`recorder: could not remove stale work dir ${workDir}:`, err.message);
            }
            return { finalized: false, reason: 'no-sidecar' };
        }

        const resolvedEnc = enc || resolveEncoding({ codec: state.ext });
        const ext = state.ext || resolvedEnc.ext;
        const primaryName = `${folder}-${stamp}.${ext}`;
        const folderDir = path.join(audioBase, folder);
        const primaryPath = path.join(folderDir, primaryName);

        if (fs.existsSync(primaryPath)) {
            // Already finalised — idempotent no-op. Drop the work dir so a later
            // call does not keep re-checking it.
            try {
                fs.rmSync(workDir, { recursive: true, force: true });
            } catch (err) {
                log.error(`recorder: could not remove finalised work dir ${workDir}:`, err.message);
            }
            return { finalized: false, reason: 'already-finalised' };
        }

        // Write to a temp name first then atomic-rename into place so a reader
        // never sees a half-written primary file. finalizeSidecar validates each
        // sidecar fragment against the disk BEFORE building the timeline (hotfix
        // RC2): the ledger can reference a fragment that was never written / was
        // lost (the production `956-0.mp3` case), and feeding such a name to
        // ffmpeg exits 1 ("No such file or directory"). A missing/zero-byte/
        // unreadable fragment is dropped (buildTimeline widens the surrounding
        // silence over its offset range so the hour stays exactly 3600s); if
        // NOTHING survives it returns { finalized:false, reason:
        // 'no-usable-fragments' } instead of emitting a broken/empty file; and a
        // failed finalise removes its half-written temp before re-throwing.
        const tmpName = `.finalize.${process.pid}.${Date.now()}.${ext}`;

        const status = await finalizeSidecar(
            {
                workDir,
                folderDir,
                primaryName,
                tmpName,
                fragments: state.fragments || [],
                enc: resolvedEnc,
            },
            { fs, log },
        );

        if (!status.finalized && status.reason === 'no-usable-fragments') {
            // Every fragment the ledger referenced is missing/empty: do not emit
            // a broken/empty hour and do not crash. Clean up the orphaned work
            // dir (and any stray temp) and skip finalisation.
            log.warn(`recorder: all fragments missing for ${folder} ${stamp}, skipping finalise and cleaning up work dir.`);
            try {
                fs.rmSync(workDir, { recursive: true, force: true });
            } catch (err) {
                log.error(`recorder: could not remove work dir ${workDir} after no-usable-fragments skip:`, err.message);
            }
            return { finalized: false, reason: 'no-usable-fragments' };
        }

        // Record the hour's size + 'complete' status now the primary exists.
        // gapSeconds is the whole-second silence the timeline padded in for
        // down-windows (including any dropped-fragment range); the hour stays
        // 'complete' — a gap-padded hour is a full-length file with silence.
        recordCompleteRow(folder, stamp, status.sizeBytes, status.gapSeconds);

        // Remove the work dir now the hour is finalised.
        try {
            fs.rmSync(workDir, { recursive: true, force: true });
        } catch (err) {
            log.error(`recorder: could not remove work dir ${workDir} after finalise:`, err.message);
        }

        return { finalized: true, primaryPath, fragments: status.fragments };
    })();

    finalizing.set(key, run);
    // Clear the mutex entry whether the finalise resolved or rejected so a
    // later retry (cron/boot) can run again. CRITICAL (hotfix RC1a): the cleanup
    // must NOT leave a derived promise unhandled. A bare `run.finally(cleanup)`
    // returns a NEW promise that re-raises run's rejection; nobody awaits it, so
    // under Node's default --unhandled-rejections=throw (Node >=15) that stray
    // rejection crashed the recorder. Attaching cleanup via then(cleanup, cleanup)
    // runs it on both settle paths AND marks run's rejection as handled on this
    // chain, and the trailing .catch(()=>{}) swallows any throw from cleanup
    // itself, so no unhandled rejection can ever escape here. The returned `run`
    // is unchanged, so the real rejection still surfaces to the caller's .catch.
    const cleanup = () => {
        if (finalizing.get(key) === run) {
            finalizing.delete(key);
        }
    };
    run.then(cleanup, cleanup).catch(() => {});
    return run;
}

// List the stamps of every `.inprogress/<stamp>` work dir under `folder`.
// Returns [] for a missing folder / missing .inprogress dir / unreadable dir
// (never throws) so the cron + boot backstops can scan safely.
function listInprogressStamps(audioBase, folder) {
    if (!isValidFolder(folder) || !isContainedPath(audioBase, folder)) {
        return [];
    }
    const base = path.join(audioBase, folder, '.inprogress');
    try {
        return fs
            .readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    } catch {
        return [];
    }
}

// Boot-time stale `.finalize.*` sweep (hotfix RC3). A finalise writes to a temp
// name `.finalize.<pid>.<ts>.<ext>` and atomic-renames it onto the primary on
// success; a crash mid-finalise (the old crash-loop) left the temp behind, so
// production accumulated a pile of empty `.finalize.*` files. Fixing the crash
// stops NEW leaks; this sweep clears the existing backlog. It only ever touches
// `.finalize.*` entries directly under a CONTAINED, valid stream folder (reusing
// isValidFolder + isContainedPath), never recurses, and never throws — a failure
// only logs. Returns the number of temps removed (for logging/tests).
function sweepStaleFinalizeTemps(audioBase, streams) {
    const list = Array.isArray(streams) ? streams : [];
    let removed = 0;
    for (const item of list) {
        const folder = item && item.folder;
        if (!isValidFolder(folder) || !isContainedPath(audioBase, folder)) {
            continue;
        }
        const folderDir = path.join(audioBase, folder);
        let entries;
        try {
            entries = fs.readdirSync(folderDir, { withFileTypes: true });
        } catch {
            continue; // folder not present yet / unreadable — nothing to sweep
        }
        for (const ent of entries) {
            if (!ent.isFile() || !ent.name.startsWith('.finalize.')) {
                continue;
            }
            const tmpPath = path.join(folderDir, ent.name);
            try {
                fs.rmSync(tmpPath, { force: true });
                removed += 1;
            } catch (err) {
                log.error(`recorder: could not remove stale finalise temp ${tmpPath}:`, err.message);
            }
        }
    }
    if (removed > 0) {
        log.info(`recorder: swept ${removed} stale .finalize temp file(s) at boot.`);
    }
    return removed;
}

// Cron/boot BACKSTOP (trigger b): finalise every PAST-hour `.inprogress/<stamp>`
// dir for each configured stream — a dir whose stamp is not the current hour is
// a rolled-over hour whose ffmpeg-end finalise never landed (crash/update
// reboot), so finalizeIfNeeded lays its fragments on the timeline (down-window
// -> silence) and writes the single primary file. IDEMPOTENT via the finalise
// mutex + already-finalised check. The CURRENT hour is left alone (still being
// captured). Best-effort: a per-stream error only logs. Returns a promise that
// resolves once all triggered finalises settle.
function finalizePastHours(streams) {
    const currentStamp = currentHourStamp();
    const list = Array.isArray(streams) ? streams : [];
    const jobs = [];
    for (const item of list) {
        const enc = resolveEncoding(item);
        for (const stamp of listInprogressStamps(AUDIO_BASE, item.folder)) {
            if (stamp === currentStamp) {
                continue; // current hour still capturing — not a backstop target
            }
            jobs.push(
                finalizeIfNeeded(AUDIO_BASE, item.folder, stamp, enc).catch((err) => {
                    log.error(`recorder: backstop finalise failed for ${item.folder} ${stamp}:`, err.message);
                }),
            );
        }
    }
    return Promise.all(jobs);
}

// Function to read settings and start recording. Each stream is routed through
// the per-stream supervisor so a single stream's ffmpeg failure restarts only
// that stream (deliverable 1).
function startRecording() {
    const streams = readStreams();
    streams.forEach(item => {
        // superviseStream is async (rev-3); .catch so a rejected supervise for
        // one stream never becomes an unhandled rejection or aborts the loop.
        superviseStream(item, 0).catch((err) => {
            log.error(`recorder: supervise for ${item.folder} failed:`, err);
        });
    });
}

// The per-tick body, shared by the original task and any rescheduled task.
function recordingTick() {
    writeHeartbeat();
    try {
        const now = new Date;
        log.info(`Starting recording at `+String(now.getHours()).padStart(2, '0')+`:`+currentMinute.toString().padStart(2, '0')+`.`);
        // Backstop: finalise any PAST-hour .inprogress dir left behind by a
        // missed ffmpeg-end (crash/update reboot) before starting this hour.
        // Best-effort and idempotent; never blocks the fresh-hour start.
        finalizePastHours(readStreams()).catch((err) => {
            log.error('recorder: cron backstop finalise failed:', err);
        });
        startRecording();
    } catch (err) {
        // A transient error (e.g. unreadable stream list) must not crash the
        // worker; log a greppable line and wait for the next tick.
        log.error('recorder: error during scheduled recording tick:', err);
        return;
    }
}

// Schedule the startRecording function to run at `currentMinute` of every hour.
// The task handle is captured so the re-read timer can stop and replace it when
// the minute changes (hot-reschedule).
let task = cron.schedule(`${currentMinute} * * * *`, recordingTick);

// Best-effort hot-reschedule (design §5.1, A5). A low-frequency timer re-reads
// recorder_minute from the DB; when it differs from the currently scheduled
// minute, the existing node-cron task is stopped and replaced with a new one at
// the new minute (node-cron@^4.6.0 exposes task.stop()). FALLBACK: if the task
// cannot be replaced, a changed minute takes effect on the next container
// restart (the minute is always read from the DB, never settings.json).
//
// A not-ready DB at boot falls back to minute 0, so the first hour can record
// at xx:00 until this timer first corrects it. To shrink that window after a
// fallback boot, the first few re-reads run sooner (~15s, then ~60s) before
// settling into the steady 5-minute cadence; this is accepted best-effort
// behavior, not a bug.
const RESCHEDULE_STEADY_MS = 5 * 60 * 1000;
const RESCHEDULE_FIRST_RETRIES_MS = [15 * 1000, 60 * 1000];

// Handle of the pending hot-reschedule setTimeout, captured so graceful
// shutdown can clear it (deliverable 2). The chain already uses .unref() so it
// does not keep the event loop alive; clearing it on shutdown is for
// cleanliness and to stop any further reschedule work mid-teardown.
let rescheduleTimer = null;

function rescheduleCheck() {
    try {
        const newMinute = readRecorderMinute();
        if (newMinute !== currentMinute) {
            const newExpr = `${newMinute} * * * *`;
            task.stop();
            task = cron.schedule(newExpr, recordingTick);
            log.info(`recorder: recorder_minute changed from ${currentMinute} to ${newMinute}; rescheduled to run at xx:${newMinute.toString().padStart(2, '0')}.`);
            currentMinute = newMinute;
        }
    } catch (err) {
        // Best-effort: a failed re-read/reschedule must not crash the recorder;
        // the next timer fire (or a restart) will retry.
        log.error('recorder: re-read/reschedule check failed:', err);
    }
}

function scheduleReread(delays) {
    if (shuttingDown) {
        return;
    }
    const [next, ...rest] = delays;
    const delay = next !== undefined ? next : RESCHEDULE_STEADY_MS;
    rescheduleTimer = setTimeout(() => {
        rescheduleCheck();
        scheduleReread(rest);
    }, delay);
    rescheduleTimer.unref();
}
scheduleReread(RESCHEDULE_FIRST_RETRIES_MS);

// --- Graceful shutdown (deliverable 2) --------------------------------------
// On SIGTERM/SIGINT: flip the shutting-down flag (so no supervisor schedules a
// new restart), SIGTERM every tracked ffmpeg command so each in-progress mp3 is
// finalized/closed rather than truncated (SIGTERM, NOT SIGKILL — D5), stop the
// cron task and clear the hot-reschedule timer, close the read-only DB handle
// (the recorder opens the DB per-read via streams-db.js and closes it each
// time, so there is no long-lived handle to close here), and exit 0. A bounded
// grace window guarantees we still exit 0 even if an ffmpeg process is slow to
// finalize, so shutdown can never hang forever. Idempotent against a second
// signal. The recorder writes /tmp/heartbeat at boot and on each cron tick and
// does NOT run a periodic heartbeat setInterval, so there is no heartbeat timer
// to clear here (see plan D6).
const SHUTDOWN_GRACE_MS = 8000;

function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    log.info(`recorder: received ${signal}, shutting down gracefully (finalizing ${active.size} active recording(s)).`);

    // Stop scheduling: no more hourly ticks, no more reschedule re-reads.
    try {
        task.stop();
    } catch (err) {
        log.error('recorder: error stopping cron task during shutdown:', err);
    }
    if (rescheduleTimer) {
        clearTimeout(rescheduleTimer);
        rescheduleTimer = null;
    }
    if (newStreamPollTimer) {
        clearInterval(newStreamPollTimer);
        newStreamPollTimer = null;
    }
    if (livePreviewTimer) {
        clearInterval(livePreviewTimer);
        livePreviewTimer = null;
    }

    // Finalize each in-progress recording. SIGTERM lets ffmpeg close the mp3
    // container cleanly; marking intentionalStop prevents the supervisor from
    // treating the resulting error/end as a failure to restart.
    for (const [id, entry] of active) {
        // A command-less entry is a supervision still inside its source-probe
        // window (rev-3): no ffmpeg to SIGTERM yet. Drop it and move on — the
        // supervisor re-checks shuttingDown after its await and bails itself.
        if (!entry.command) {
            active.delete(id);
            continue;
        }
        entry.intentionalStop = true;
        try {
            log.info(`recorder: finalizing recording for ${entry.item.name} (folder ${entry.item.folder}) on ${signal}.`);
            entry.command.kill('SIGTERM');
        } catch (err) {
            log.error(`recorder: error finalizing recording for ${entry.item.folder} during shutdown:`, err);
        }
    }

    const finish = () => {
        log.info('recorder: shutdown complete, exiting 0.');
        process.exit(0);
    };

    // If every recording finalized quickly, exit promptly; otherwise exit after
    // a bounded grace window so shutdown cannot hang.
    const poll = setInterval(() => {
        if (active.size === 0) {
            clearInterval(poll);
            finish();
        }
    }, 200);
    poll.unref();

    const graceTimer = setTimeout(() => {
        clearInterval(poll);
        if (active.size > 0) {
            log.error(`recorder: ${active.size} recording(s) did not finalize within ${SHUTDOWN_GRACE_MS}ms; exiting 0 anyway.`);
        }
        finish();
    }, SHUTDOWN_GRACE_MS);
    graceTimer.unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Boot succeeded: record an initial heartbeat so the healthcheck has a fresh
// timestamp before the first cron tick fires.
writeHeartbeat();

// Startup catch-up: cron is already registered above, so even if this block
// throws, the hourly schedule is live. For each configured stream, if no
// recording file exists for the CURRENT hour yet, start a recording for the
// remainder of this hour; the normal cron tick takes over at the next hour.
// Streams are read from the shared SQLite DB (read-only) via readStreams().
// Because the recorder can boot before the api has created/seeded the DB, the
// read is wrapped in a bounded retry (~10s worst case) so a not-instantly-ready
// DB does not make catch-up silently record nothing for the current hour. The
// bound MUST NOT be short-circuited on the first empty read (that reintroduces
// the AC-13 race); a legitimately empty DB just exits after the bound.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// True when the FINALISED primary file for the current hour already exists for
// `folder` — the hour is done and must not be restarted. Honors the primary
// name convention `<folder>-<stamp>.<ext>` (ext = the stream's resolved codec
// extension; defaults to 'mp3' for a field-less/legacy row). Capture no longer
// writes this file (finalise does), so its presence means "already finalised".
function hasPrimaryFile(folder, stamp, ext = 'mp3') {
    if (!isValidFolder(folder)) {
        return false;
    }
    const outputPath = path.join(__dirname, `./audio/${folder}/${folder}-${stamp}.${ext}`);
    return fs.existsSync(outputPath);
}

// True when this process is ACTIVELY capturing `folder` right now (an entry in
// the supervision registry whose command has started). Distinguishes a live
// capture (skip) from a stale .inprogress dir left by a crashed capture
// (resume). A command-less entry is a supervision still inside its probe window
// — count it as active so the poll does not double-start it.
function isActivelyCapturing(folder) {
    for (const entry of active.values()) {
        if (entry && entry.item && entry.item.folder === folder) {
            return true;
        }
    }
    return false;
}

// Start a remainder-of-the-hour recording for every configured stream that has
// no current-hour file yet, routing each through the per-stream supervisor so a
// mid-hour drop is restarted with backoff (deliverable 1). This single code
// path is used BOTH by the one-shot startup catch-up and by the periodic poll
// that auto-starts newly-added streams; `reason` only tags the log lines. One
// stream's failure never aborts the others. The caller passes the (already
// read) stream list so the bounded startup retry and the poll can each supply
// their own list without this function re-reading the DB.
function runCatchup(streams, reason) {
    const stamp = currentHourStamp();
    const remaining = secondsUntilNextHour();
    // Resolve each stream's codec extension once so the "exists = skip" probe
    // looks for the primary file with the right extension (opus/flac streams
    // never re-trigger a catch-up because a .mp3 was missing).
    const extByFolder = new Map(
        (Array.isArray(streams) ? streams : []).map((item) => [item.folder, resolveEncoding(item).ext])
    );
    // .inprogress-aware decision (FEAT-002): skip a folder only if the hour is
    // already finalised (primary file present) OR a capture for it is actively
    // running in this process; otherwise resume/top-up (a fresh hour or a stale
    // .inprogress dir from a crash both resolve to the same "append now" action,
    // and the pre-capture gap finalises to silence).
    const needing = streamsNeedingCatchup(streams, (folder) =>
        currentHourDecision({
            hasPrimary: hasPrimaryFile(folder, stamp, extByFolder.get(folder) || 'mp3'),
            isActivelyCapturing: isActivelyCapturing(folder),
        }) === 'skip');
    needing.forEach((item) => {
        try {
            log.info(`recorder: ${reason} starting for ${item.folder}: no recording for hour ${stamp} yet (${remaining}s remaining).`);
            // superviseStream is async (rev-3); .catch so a rejected supervise
            // never becomes an unhandled rejection (the sync try/catch below
            // only catches a synchronous throw before the first await).
            superviseStream(item, 0).catch((err) => {
                log.error(`recorder: ${reason} supervise for ${item.folder} failed:`, err);
            });
        } catch (err) {
            // One stream's failure must not abort the others or crash the process.
            log.error(`recorder: ${reason} error for ${item.folder}:`, err);
        }
    });
}

// Boot RESUME pass (FEAT-002, trigger (a)+(c)), run BEFORE runCatchup. For each
// configured stream:
//   - finalise every PAST-hour .inprogress dir (a rolled-over hour whose
//     ffmpeg-end never ran because the process was killed/updated) so its
//     fragments become a ~3600s silence-padded primary file. This is exactly
//     the cron backstop, reused here at boot.
//   - the CURRENT hour is intentionally NOT finalised here: runCatchup (called
//     right after) resumes it by starting a new fragment at
//     startOffset=elapsedThisHour() for secondsUntilNextHour() seconds; the
//     [lastClosed..elapsedNow] down-window finalises to silence when the hour
//     later rolls over. A stale current-hour .inprogress dir with no live
//     capture is precisely the "resume" case runCatchup now handles.
// Best-effort: a failure only logs; the cron schedule is already live.
async function resumePass(streams) {
    await finalizePastHours(streams);
}

(async () => {
    let catchupStreams = readStreams();
    for (let i = 0; i < 10 && catchupStreams.length === 0; i++) {
        await sleep(1000);
        catchupStreams = readStreams();
    }
    // Clean the backlog of stale `.finalize.*` temps left by the old crash-loop
    // (hotfix RC3) before anything else. Best-effort; never blocks capture.
    try {
        sweepStaleFinalizeTemps(AUDIO_BASE, catchupStreams);
    } catch (err) {
        log.error('recorder: stale finalise-temp sweep failed:', err.message);
    }
    // Crash-loop containment (hotfix RC4): schedule the CURRENT hour's capture
    // FIRST, so even if every past-hour finalise fails the recorder still comes
    // up and records this hour. Past-hour finalisation is best-effort and is
    // fired AFTER, WITHOUT awaiting it, so a slow/failing backstop can never
    // block or delay current-hour capture. resumePass/finalizePastHours already
    // isolate each stream/hour with its own try/catch + .catch, so one broken
    // hour cannot abort the others.
    runCatchup(catchupStreams, 'catch-up');
    resumePass(catchupStreams).catch((err) => {
        // Best-effort boot backstop; the cron schedule + current hour are live.
        log.error('recorder: boot resume pass failed:', err);
    });
})().catch((err) => {
    // The whole catch-up is best-effort; the cron schedule is already live.
    log.error('recorder: startup catch-up failed:', err);
});

// --- Periodic new-stream catch-up poll (scope addition) ---------------------
// A stream added on the settings page appears in the DB streams table but is
// only recorded from the NEXT hourly cron tick onward. This low-frequency poll
// re-reads the stream list over the existing read-only DB handle and, reusing
// the exact catch-up path above, starts a remainder-of-the-hour recording for
// any stream with no current-hour file yet. That naturally starts a brand-new
// stream right away, skips streams already recording/recorded this hour (the
// "exists = skip" check), and is harmless for streams the cron already handles.
// Each poll is wrapped so a transient DB read error logs and is retried on the
// next tick (never crashes the recorder), and poll-triggered recordings are
// supervised/backed-off like any other. OPTION A (recorder-only) is used
// deliberately: pushing this from the api would be out of this workflow's scope.
const NEW_STREAM_POLL_MS = 30 * 1000; // re-check for newly-added streams every 30s
let newStreamPollTimer = null;

function newStreamPollTick() {
    try {
        const streams = readStreams();
        runCatchup(streams, 'new-stream poll catch-up');
    } catch (err) {
        // Failure-isolated: log and let the next tick retry.
        log.error('recorder: new-stream poll failed, will retry next tick:', err);
    }
}

function scheduleNewStreamPoll() {
    if (shuttingDown) {
        return;
    }
    newStreamPollTimer = setInterval(newStreamPollTick, NEW_STREAM_POLL_MS);
    newStreamPollTimer.unref();
}
scheduleNewStreamPoll();

// --- Periodic live-preview tick (FEAT-002, Regression 2) --------------------
// The canonical primary <folder>-<stamp>.<ext> is written only once, at the
// hour boundary, so the CURRENT hour was unplayable mid-hour. This low-frequency
// tick writes a NON-CANONICAL, ELAPSED-length preview of the current hour to
// audio/<folder>/.live/<stamp>.<ext> (distinct name, hidden dotfile dir) by
// reusing buildTimeline + finalizeHour via writeLivePreview. It reads ONLY the
// current hour's .inprogress/<currentHourStamp()>/state.json sidecar — a stream
// with no sidecar yet is a no-op. It NEVER writes the canonical primary and
// NEVER touches finalizeIfNeeded/finalizePastHours, so the one-3600s-primary
// invariant and its idempotency guard are unchanged. Each stream is isolated in
// its own try/catch and writeLivePreview is itself best-effort (logs + swallows
// every error). Mirrors the new-stream poll's schedule/clear/.unref() pattern.
const LIVE_PREVIEW_MS = 150000; // refresh the current-hour preview every ~2.5 min
let livePreviewTimer = null;

function livePreviewTick() {
    try {
        const streams = readStreams();
        const stamp = currentHourStamp();
        for (const item of Array.isArray(streams) ? streams : []) {
            try {
                const folder = item && item.folder;
                if (!folder) {
                    continue;
                }
                // Only preview a stream that has a current-hour work dir; skip
                // the finalizeHour/ffmpeg cost when nothing is captured yet.
                const workDir = inprogressDir(AUDIO_BASE, folder, stamp);
                if (!fs.existsSync(workDir)) {
                    continue;
                }
                const enc = resolveEncoding(item);
                writeLivePreview(AUDIO_BASE, folder, stamp, enc, {
                    fs,
                    log,
                    readState,
                    buildTimeline,
                    finalizeHour,
                }).catch((err) => {
                    // writeLivePreview already swallows its own errors; this is a
                    // belt-and-braces guard so a rejected promise can never
                    // surface as an unhandled rejection.
                    log.error(`recorder: live preview for ${folder} ${stamp} rejected:`, err && err.message);
                });
            } catch (err) {
                // One stream's preview failure never aborts the others.
                log.error('recorder: live preview tick per-stream error:', err && err.message);
            }
        }
    } catch (err) {
        // Failure-isolated: log and let the next tick retry.
        log.error('recorder: live preview tick failed, will retry next tick:', err);
    }
}

function scheduleLivePreview() {
    if (shuttingDown) {
        return;
    }
    livePreviewTimer = setInterval(livePreviewTick, LIVE_PREVIEW_MS);
    livePreviewTimer.unref();
}
scheduleLivePreview();

log.info(`Recorder is OK! The recorder process will run every hour at xx:`+currentMinute.toString().padStart(2, '0')+`.`);
