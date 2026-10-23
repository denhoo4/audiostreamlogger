const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const cron = require('node-cron');

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
function recordStream(name, folder, url) {
    const audioFolderPath = path.join(__dirname, `./audio/${folder}`);
    fs.mkdirSync(audioFolderPath, { recursive: true });

    const currentDate = new Date();
    const formattedDate = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}-${String(currentDate.getHours()).padStart(2, '0')}`;
    const outputPath = `${audioFolderPath}/${folder}-${formattedDate}.mp3`;

    ffmpeg()
        .input(url)
        .inputOptions('-user_agent', `'${name} Logger'`)
        .duration('01:00:00')
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
    const now = new Date;
    console.log(`Starting recording at `+String(now.getHours()).padStart(2, '0')+`:`+recorder_minute.toString().padStart(2, '0')+`.`);
    startRecording();
});

console.log(`Recorder is OK! The recorder process will run every hour at xx:`+recorder_minute.toString().padStart(2, '0')+`.`);