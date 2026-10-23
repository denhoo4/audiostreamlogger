const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

router.use(express.json());

// Safely remove a temp file; never throws so it can be called from any path.
function cleanupTempFile(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (err) {
        console.log('Error cleaning up temp file: ' + err.message);
    }
}

router.post('/selection-export', (req, res) => {
    const data = req.body || {};

    // Extract data from the request
    const { station_id, year, month, day, hour, startTime, endTime } = data;

    // Validate the path components against strict whitelists to prevent path traversal.
    if (
        typeof station_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(station_id) ||
        typeof year !== 'string' || !/^\d{4}$/.test(year) ||
        typeof month !== 'string' || !/^\d{2}$/.test(month) ||
        typeof day !== 'string' || !/^\d{2}$/.test(day) ||
        typeof hour !== 'string' || !/^\d{2}$/.test(hour)
    ) {
        return res.status(400).send('Invalid parameters');
    }

    // Validate startTime/endTime are finite, non-negative numbers with endTime > startTime.
    const start = Number(startTime);
    const end = Number(endTime);
    if (
        !Number.isFinite(start) || !Number.isFinite(end) ||
        start < 0 || end < 0 || end <= start
    ) {
        return res.status(400).send('Invalid time range');
    }

    const file = `${station_id}/${station_id}-${year}-${month}-${day}-${hour}.mp3`;

    // Resolve the requested file and confirm it stays within the audio base dir.
    const audioBaseDir = path.resolve(__dirname, '../audio');
    const pathToFile = path.resolve(audioBaseDir, file);
    if (pathToFile !== audioBaseDir && !pathToFile.startsWith(audioBaseDir + path.sep)) {
        return res.status(400).send('Invalid parameters');
    }

    // Check if the file exists
    if (!fs.existsSync(pathToFile)) {
        return res.status(404).send('File not found');
    }

    // Write the ffmpeg output to a unique temp file outside the public audio dir.
    const pathToOutput = path.join(os.tmpdir(), `export-${Date.now()}-${process.pid}.mp3`);

    // Use FFmpeg to extract the part of the MP3
    ffmpeg(pathToFile)
        .setStartTime(start)
        .setDuration(end - start)
        .output(pathToOutput)
        .on('end', function () {
            // Send the file when processing is finished, then always clean up.
            res.sendFile(pathToOutput, (err) => {
                if (err) {
                    console.log('Error sending file: ' + err.message);
                }
                cleanupTempFile(pathToOutput);
            });
        })
        .on('error', function (err) {
            console.log('Error: ' + err.message);
            cleanupTempFile(pathToOutput);
            res.status(500).send('Error processing file');
        })
        .run();
});

module.exports = router;
