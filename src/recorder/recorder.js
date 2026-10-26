const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cron = require('node-cron');
const log = require('./log');
const { secondsUntilNextHour, currentHourStamp } = require('./time-helpers');
const { readStreams, readRecorderMinute } = require('./streams-db');
const { backoffDelayMs, shouldRestartWithinHour, segmentOutputName } = require('./backoff-helpers');
const { isValidFolder, isContainedPath } = require('./folder-utils');
const { streamsNeedingCatchup } = require('./catchup-helpers');
const recordingsDb = require('./recordings-db');
const { resolveEncoding, outputOptionsFor, copyOutputOptions } = require('./encoding');
const { detectSource, isCopyEligible } = require('./detect-source');

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

function recordSegmentRow(folder, stamp, attempt) {
    if (!recordingsHandle) {
        return;
    }
    try {
        recordingsDb.markSegment(recordingsHandle, { folder, stamp, attempt });
    } catch (err) {
        log.error(`recorder: recordings segment-row write failed for ${folder} ${stamp} (attempt ${attempt}):`, err.message);
    }
}

function recordCompleteRow(folder, stamp, sizeBytes) {
    if (!recordingsHandle) {
        return;
    }
    try {
        recordingsDb.markComplete(recordingsHandle, { folder, stamp, sizeBytes });
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
// -ar 44100`. `attempt` only changes the output filename for a mid-hour restart
// (attempt 0 keeps `<folder>-<stamp>.<ext>`, attempt >= 1 writes a distinct
// `<folder>-<stamp>.partN.<ext>` segment — see segmentOutputName/D2). An
// unrecognised/NULL codec clamps to mp3 defensively and logs a greppable warn.
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
function recordStream(item, durationSeconds = 3600, attempt = 0, detected = null) {
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

    const audioFolderPath = path.join(__dirname, `./audio/${folder}`);
    fs.mkdirSync(audioFolderPath, { recursive: true });

    const formattedDate = currentHourStamp();
    const outputPath = `${audioFolderPath}/${segmentOutputName(folder, formattedDate, attempt, enc.ext)}`;

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

    // The hour stamp + primary output path for this supervision, captured once
    // so the recordings-row writes (FEAT-002) key on the same hour and the
    // finalize stats the file ffmpeg is actually writing.
    const stamp = currentHourStamp();
    const enc = resolveEncoding(item);
    const outputName = segmentOutputName(item.folder, stamp, attempt, enc.ext);
    const outputPath = path.join(__dirname, `./audio/${item.folder}/${outputName}`);

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
    // resolved codec extension so file_path matches what ffmpeg writes); a
    // mid-hour restart (attempt >= 1) flips it to 'partial' with the new
    // segment count. Best-effort — never throws into the supervisor.
    if (attempt === 0) {
        recordStartRow(item.folder, stamp, enc.ext);
    } else {
        recordSegmentRow(item.folder, stamp, attempt);
    }

    const command = recordStream(item, remaining, attempt, detected);
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
        if (entry.intentionalStop) {
            log.info(`recorder: ffmpeg for ${item.name} (folder ${item.folder}) finalized during shutdown.`);
            return;
        }
        if (shuttingDown) {
            return;
        }
        // Normal finalize (not an intentional stop, not shutdown): stat the mp3
        // ffmpeg just wrote and record size_bytes + status 'complete' for the
        // hour. markComplete leaves an already-'partial' hour 'partial'. Best-
        // effort: a stat/DB error only logs, never throws into this callback.
        let sizeBytes = null;
        try {
            sizeBytes = fs.statSync(outputPath).size;
        } catch (err) {
            log.error(`recorder: could not stat ${outputPath} for recordings size:`, err.message);
        }
        recordCompleteRow(item.folder, stamp, sizeBytes);
    });

    return id;
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

// True when a recording file for the current hour already exists for `folder`
// (the "exists = skip" rule). Shared by the startup catch-up and the periodic
// poll so both honor the same primary-filename convention
// `<folder>-<stamp>.<ext>` where ext is the stream's resolved codec extension
// (defaults to 'mp3' for a field-less/legacy row).
function hasCurrentHourRecording(folder, stamp, ext = 'mp3') {
    if (!isValidFolder(folder)) {
        return false;
    }
    const outputPath = path.join(__dirname, `./audio/${folder}/${folder}-${stamp}.${ext}`);
    return fs.existsSync(outputPath);
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
    const needing = streamsNeedingCatchup(streams, (folder) =>
        hasCurrentHourRecording(folder, stamp, extByFolder.get(folder) || 'mp3'));
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

(async () => {
    let catchupStreams = readStreams();
    for (let i = 0; i < 10 && catchupStreams.length === 0; i++) {
        await sleep(1000);
        catchupStreams = readStreams();
    }
    runCatchup(catchupStreams, 'catch-up');
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

log.info(`Recorder is OK! The recorder process will run every hour at xx:`+currentMinute.toString().padStart(2, '0')+`.`);
