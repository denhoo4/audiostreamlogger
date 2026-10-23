/**
 * Peakfilegenerator job handler (ported from src/peakfilegenerator/peakfilegenerator.js,
 * FR-2.7 + MEDIUM-3).
 *
 * Reads the streams list via the RW handle (SELECT folder FROM streams) to know
 * which per-stream folders to scan, then keeps the faithful two-level directory
 * walk: readdirSync(AUDIO_DIR) -> directories -> readdirSync(subdir) -> .mp3.
 * extractFileDateTime(filename) === null skips the file (logged); current-hour
 * files are skipped; for the rest, a missing .json peak is generated with
 * execSync('audiowaveform ...'). A per-file audiowaveform failure is logged but
 * does not fail the job; a top-level directory-read failure throws -> failed.
 * The walk is explicit two-level readdir, never a glob shorthand.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { extractFileDateTime } = require('../filename-utils');
const { AUDIO_DIR } = require('./paths');

/**
 * Current date-time in "YYYY-MM-DD-HH" local format, matching the audio filename
 * stamp, so files still being recorded this hour are skipped.
 */
function currentHourStamp(now) {
    return (
        `${now.getFullYear()}-` +
        `${String(now.getMonth() + 1).padStart(2, '0')}-` +
        `${String(now.getDate()).padStart(2, '0')}-` +
        `${String(now.getHours()).padStart(2, '0')}`
    );
}

/**
 * Run the peakfilegenerator once. Returns a summary string on success; a
 * top-level directory-read failure throws -> failed.
 */
function runPeakfileGenerator(db) {
    const log = [];
    const currentDateTime = currentHourStamp(new Date());

    // MEDIUM-3: read the streams folders from the DB. These are the per-stream
    // subdirectory names the two-level walk expects to find under AUDIO_DIR.
    const streamFolders = new Set(
        db.prepare('SELECT folder FROM streams').all().map((r) => r.folder)
    );
    log.push(
        `Peakfile run at ${new Date().toISOString()}: ${streamFolders.size} stream folder(s) known, scanning ${AUDIO_DIR}.`
    );

    const counters = { generated: 0, errors: 0, skipped: 0 };

    // Two-level walk. A top-level read failure throws -> the job fails.
    const topEntries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
    topEntries
        .filter((dirent) => dirent.isDirectory())
        .filter((dirent) => streamFolders.has(dirent.name))
        .forEach((dirent) => {
            const outputFolder = path.join(AUDIO_DIR, dirent.name);

            fs.readdirSync(outputFolder)
                .filter((file) => path.extname(file) === '.mp3')
                .forEach((file) => {
                    const filename = path.basename(file, '.mp3');
                    const jsonFilePath = path.join(outputFolder, `${filename}.json`);

                    const fileDateTime = extractFileDateTime(filename);
                    if (fileDateTime === null) {
                        log.push(`Skipping file with no date pattern: ${file}`);
                        counters.skipped += 1;
                        return;
                    }

                    // Skip files of the current hour (still being recorded).
                    if (fileDateTime === currentDateTime) {
                        return;
                    }

                    if (!fs.existsSync(jsonFilePath)) {
                        const mp3FilePath = path.join(outputFolder, file);
                        const command = `audiowaveform -i "${mp3FilePath}" -o "${jsonFilePath}" --pixels-per-second 20 --bits 8`;
                        try {
                            execSync(command);
                            log.push(`Generated peak file: ${jsonFilePath}`);
                            counters.generated += 1;
                        } catch (error) {
                            log.push(
                                `Error executing audiowaveform for ${mp3FilePath}: ${error.message}`
                            );
                            counters.errors += 1;
                        }
                    }
                });
        });

    log.push(
        `Peakfile done: ${counters.generated} generated, ${counters.skipped} skipped (no date pattern), ${counters.errors} error(s).`
    );
    return log.join('\n');
}

module.exports = { runPeakfileGenerator };
