const fs = require('fs');
const path = require('path');
const cron = require('node-cron');


// Getting the retention time of logs from the settings.json
const settingsPath = '/usr/src/app/settings.json';
let settings;
try {
    const settingsData = fs.readFileSync(settingsPath, 'utf8');
    settings = JSON.parse(settingsData);
} catch (err) {
    console.error('Error reading settings.json:', err);
    process.exit(1);
}

const log_retention = settings.cleaner.log_retention;
const cleaner_minute = settings.cleaner.cleaner_minute;

// If the log_retention variable is bigger than 0 and an integer, it throws an error.
try {
    if (!Number.isInteger(log_retention) || log_retention < 1 || log_retention > 59) {
      throw new Error("ERROR! The log_retention variable in settings.json must be an integer bigger than 0. The cleaner is will be shutdown.");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  // If the cleaner_minute variable is bigger than 0 and an integer, it throws an error.
try {
    if (!Number.isInteger(cleaner_minute) || cleaner_minute < 1 || cleaner_minute > 59) {
      throw new Error("ERROR! The cleaner_minute variable in settings.json must be an integer between 0 and 59.");
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }


// Setting up constants
const folder = "/audio";
const folderPath = path.join(__dirname, folder);
const thresholdTime = new Date(Date.now() - log_retention * 60 * 60 * 1000);


// The function that will be called to actually delete files
function deleteOldFiles(dir) {
    fs.readdir(dir, { withFileTypes: true }, (err, files) => {
        if (err) {
            console.error(`Error reading directory ${dir}:`, err);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(dir, file.name);
            if (file.isDirectory()) {
                // Recursively check subdirectories
                deleteOldFiles(filePath);
            } else {
                // If there are files in this directory, check their creation timestamp
                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        console.error(`Error getting stats for file ${filePath}:`, err);
                        return;
                    }
                    if (stats.mtime < thresholdTime) {
                        console.log(`Deleting: ${filePath}`);
                        fs.unlink(filePath, err => {
                            if (err) console.error(`Error deleting file ${filePath}:`, err);
                        });
                    }
                });
            }
        });
    });
}

// Schedule the deleteOldFiles function to run every hour at xx:05
cron.schedule(`${cleaner_minute} * * * *`, () => {
    console.log(`Running scheduled file deletion at ${new Date().toISOString()}`);
    deleteOldFiles(folderPath);
});


// Logging to see if the cleaner container is initialized properly
console.log(`Cleaner is OK! File deletion process will run every hour at xx:`+cleaner_minute.toString().padStart(2, '0')+` and deletes files older than `+log_retention+` hour(s).`);