const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const cron = require('node-cron');
const audioDirectory = path.join(__dirname, `/audio`);

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
const peakfile_minute = settings.peakfilegenerator.peakfile_minute;

// If the peakfile_minute variable is not between 0 and 59 and an integer, it throws an error.
try {
    if (!Number.isInteger(peakfile_minute) || peakfile_minute < 0 || peakfile_minute > 59) {
      throw new Error("ERROR! The peakfile_minute variable in settings.json must be an integer between 0 and 59.");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }


function generatePeakFiles() {
    // Get current date-time in "YYYY-MM-DD-HH" format, same as the format used in the audio file names. With the goal to skip them as they are still being recorded.
    const now = new Date();
    const currentDateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}`;

    // Loop through the subdirectories of the audio directory
    fs.readdirSync(audioDirectory, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .forEach(dirent => {
          const outputFolder = path.join(audioDirectory, dirent.name);

          fs.readdirSync(outputFolder)
            .filter(file => path.extname(file) === '.mp3')
            .forEach(file => {
                const filename = path.basename(file, '.mp3');
                const jsonFilePath = path.join(outputFolder, `${filename}.json`);

                // Extract date-time from this specific filename
                const fileDateTime = filename.match(/\d{4}-\d{2}-\d{2}-\d{2}/)[0];

                // Skip the file if the file is of the current hour
                if (fileDateTime === currentDateTime) {
                    return;
                }

                // If the peakfile does nog exist, create it.
                if (!fs.existsSync(jsonFilePath)) {
                    const mp3FilePath = path.join(outputFolder, file);
                    const command = `audiowaveform -i "${mp3FilePath}" -o "${jsonFilePath}" --pixels-per-second 20 --bits 8`;

                    try {
                        execSync(command);
                    } catch (error) {
                        console.error(`Error executing audiowaveform for ${mp3FilePath}: ${error}`);
                    }
                }
            });
      });
}

// Schedule the generatePeakFiles function to run every hour at xx:03
cron.schedule(`${peakfile_minute} * * * *`, () => {
    console.log(`Running scheduled peak file generation at ${new Date().toISOString()}`);
    generatePeakFiles();
});

console.log(`Peakfile generator is OK! Generation process will run every hour at xx:`+peakfile_minute.toString().padStart(2, '0')+`.`);