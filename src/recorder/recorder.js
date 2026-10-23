const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cron = require('node-cron');
const { secondsUntilNextHour, currentHourStamp } = require('./time-helpers');
const { readStreams, readRecorderMinute } = require('./streams-db');

// Heartbeat file touched at boot and on every tick; the compose healthcheck
// checks its freshness to detect a worker that has silently stopped ticking.
const HEARTBEAT = '/tmp/heartbeat';
function writeHeartbeat() {
    try {
        fs.writeFileSync(HEARTBEAT, new Date().toISOString());
    } catch (err) {
        console.error('recorder: failed to write heartbeat:', err);
    }
}

// The recorder schedule minute now comes from the shared DB (app_config), not
// settings.json. readRecorderMinute() returns a validated 0..59 integer and
// falls back to 0 (never process.exit) when the DB is not ready. It is a
// reassignable `let` so the re-read timer below can hot-reschedule the cron
// task when the minute changes without a full container restart.
let currentMinute = readRecorderMinute();

// Function to execute ffmpeg command using fluent-ffmpeg
function recordStream(name, folder, url, durationSeconds = 3600) {
    const audioFolderPath = path.join(__dirname, `./audio/${folder}`);
    fs.mkdirSync(audioFolderPath, { recursive: true });

    const formattedDate = currentHourStamp();
    const outputPath = `${audioFolderPath}/${folder}-${formattedDate}.mp3`;

    ffmpeg()
        .input(url)
        .inputOptions('-user_agent', `'${name} Logger'`)
        .duration(durationSeconds)
        .audioFrequency(44100)
        .audioBitrate('160k')
        .output(outputPath)
        .on('start', (commandLine) => {
            console.log(`Started recording for ${name} in folder ${folder}.`);
        })
        .on('error', (err) => {
            console.error(`Error: ${err.message}`);
        })
        .on('end', () => {
            console.log(`Recording finished for ${name} in folder ${folder}`);
        })
        .run();
}

// Function to read settings and start recording
function startRecording() {
    const streams = readStreams();
    streams.forEach(item => {
        recordStream(item.name, item.folder, item.url);
    });
}

// The per-tick body, shared by the original task and any rescheduled task.
function recordingTick() {
    writeHeartbeat();
    try {
        const now = new Date;
        console.log(`Starting recording at `+String(now.getHours()).padStart(2, '0')+`:`+currentMinute.toString().padStart(2, '0')+`.`);
        startRecording();
    } catch (err) {
        // A transient error (e.g. unreadable stream list) must not crash the
        // worker; log a greppable line and wait for the next tick.
        console.error('recorder: error during scheduled recording tick:', err);
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

function rescheduleCheck() {
    try {
        const newMinute = readRecorderMinute();
        if (newMinute !== currentMinute) {
            const newExpr = `${newMinute} * * * *`;
            task.stop();
            task = cron.schedule(newExpr, recordingTick);
            console.log(`recorder: recorder_minute changed from ${currentMinute} to ${newMinute}; rescheduled to run at xx:${newMinute.toString().padStart(2, '0')}.`);
            currentMinute = newMinute;
        }
    } catch (err) {
        // Best-effort: a failed re-read/reschedule must not crash the recorder;
        // the next timer fire (or a restart) will retry.
        console.error('recorder: re-read/reschedule check failed:', err);
    }
}

function scheduleReread(delays) {
    const [next, ...rest] = delays;
    const delay = next !== undefined ? next : RESCHEDULE_STEADY_MS;
    setTimeout(() => {
        rescheduleCheck();
        scheduleReread(rest);
    }, delay).unref();
}
scheduleReread(RESCHEDULE_FIRST_RETRIES_MS);

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
(async () => {
    let catchupStreams = readStreams();
    for (let i = 0; i < 10 && catchupStreams.length === 0; i++) {
        await sleep(1000);
        catchupStreams = readStreams();
    }
    const stamp = currentHourStamp();
    const remaining = secondsUntilNextHour();
    catchupStreams.forEach(item => {
        try {
            const outputPath = path.join(__dirname, `./audio/${item.folder}/${item.folder}-${stamp}.mp3`);
            if (fs.existsSync(outputPath)) {
                console.log(`recorder: catch-up skip for ${item.folder}: recording for hour ${stamp} already exists.`);
                return;
            }
            console.log(`recorder: catch-up starting for ${item.folder}: no recording for hour ${stamp} yet (${remaining}s remaining).`);
            recordStream(item.name, item.folder, item.url, remaining);
        } catch (err) {
            // One stream's failure must not abort the others or crash the process.
            console.error(`recorder: catch-up error for ${item.folder}:`, err);
        }
    });
})().catch((err) => {
    // The whole catch-up is best-effort; the cron schedule is already live.
    console.error('recorder: startup catch-up failed:', err);
});

console.log(`Recorder is OK! The recorder process will run every hour at xx:`+currentMinute.toString().padStart(2, '0')+`.`);