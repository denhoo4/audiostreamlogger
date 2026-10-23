const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cron = require('node-cron');
const { secondsUntilNextHour, currentHourStamp } = require('./time-helpers');

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

// Getting the retention time of logs from the settings.json
const settingsPath = '/usr/src/app/settings.json';
let settings;
// If the settings.json cannot be read, throw and error
try {
    const settingsData = fs.readFileSync(settingsPath, 'utf8');
    settings = JSON.parse(settingsData);
} catch (err) {
    console.error('Error reading settings.json:', err);
    process.exit(1);
}
const recorder_minute = settings.recorder.recorder_minute;

// If the peakfile_minute variable is not between 0 and 59 and an integer, it throws an error.
try {
    if (!Number.isInteger(recorder_minute) || recorder_minute < 0 || recorder_minute > 59) {
      throw new Error("ERROR! The recorder_minute variable in settings.json must be an integer between 0 and 59.");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

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
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '/settings.json'), 'utf8'));
    const streams = json.streams;
    streams.forEach(item => {
        recordStream(item.name, item.folder, item.url);
    });
}

// Schedule the startRecording function to run at the beginning of every hour
cron.schedule(`${recorder_minute} * * * *`, () => {
    writeHeartbeat();
    try {
        const now = new Date;
        console.log(`Starting recording at `+String(now.getHours()).padStart(2, '0')+`:`+recorder_minute.toString().padStart(2, '0')+`.`);
        startRecording();
    } catch (err) {
        // A transient error (e.g. unreadable settings/stream) must not crash the
        // worker; log a greppable line and wait for the next tick.
        console.error('recorder: error during scheduled recording tick:', err);
        return;
    }
});

// Boot succeeded: record an initial heartbeat so the healthcheck has a fresh
// timestamp before the first cron tick fires.
writeHeartbeat();

// Startup catch-up: cron is already registered above, so even if this block
// throws, the hourly schedule is live. For each configured stream, if no
// recording file exists for the CURRENT hour yet, start a recording for the
// remainder of this hour; the normal cron tick takes over at the next hour.
// Streams are read exactly the way startRecording() reads them today — this is
// deliberately NOT a new settings source, to stay merge-compatible with the
// parallel settings-db work on this file.
try {
    const catchupStreams = JSON.parse(fs.readFileSync(path.join(__dirname, '/settings.json'), 'utf8')).streams;
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
} catch (err) {
    // The whole catch-up is best-effort; the cron schedule is already live.
    console.error('recorder: startup catch-up failed:', err);
}

console.log(`Recorder is OK! The recorder process will run every hour at xx:`+recorder_minute.toString().padStart(2, '0')+`.`);