/**
 * Peakfilegenerator job handler (ported from src/peakfilegenerator/peakfilegenerator.js,
 * FR-2.7 + MEDIUM-3).
 *
 * Reads the streams list via the RW handle (SELECT folder FROM streams) to know
 * which per-stream folders to scan, then keeps the faithful two-level directory
 * walk: readdirSync(AUDIO_DIR) -> directories -> readdirSync(subdir) -> .mp3.
 * extractFileDateTime(filename) === null skips the file (logged); current-hour
 * files are skipped; for the rest, a missing .json peak is generated with
 * execFileSync('audiowaveform', [...]) (no shell; paths passed as literal argv
 * elements via the pure builders in exec-args.js). A per-file audiowaveform failure is logged but
 * does not fail the job; a top-level directory-read failure throws -> failed.
 * The walk is explicit two-level readdir, never a glob shorthand.
 *
 * FEAT-003: after a file is handled (peak freshly generated OR already present),
 * fill duration_seconds (ffprobe) + size_bytes (fs.statSync) on its recordings
 * row via upsertRecordingMeta. A per-file metadata failure is logged + counted
 * and NEVER fails the job, mirroring the per-file audiowaveform handling.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { audiowaveformArgs, ffprobeDurationArgs } = require('./exec-args');
const { extractFileDateTime, parseRecordingParts } = require('../filename-utils');
const { upsertRecordingMeta } = require('../recordings-db');
const { AUDIO_DIR } = require('./paths');

// Allowlisted recording extensions the two-level walk picks up (FEAT-002).
// audiowaveform/ffprobe infer the format from the extension and the §4 probe
// confirmed each is both encodable and peak-readable.
const AUDIO_EXTS = new Set(['.mp3', '.opus', '.flac']);

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
 * Probe the duration (seconds) of an mp3 via ffprobe (the ffmpeg package in
 * Dockerfile.worker provides ffprobe). Factored out as an overridable export so
 * tests can stub it and avoid needing a real mp3 / ffprobe binary. Throws on a
 * probe/parse failure so the caller can log + count the per-file error.
 */
function probeDurationSeconds(mp3FilePath) {
    const out = execFileSync('ffprobe', ffprobeDurationArgs(mp3FilePath));
    const seconds = parseFloat(String(out).trim());
    if (!Number.isFinite(seconds)) {
        throw new Error(`ffprobe returned a non-numeric duration: ${String(out).trim()}`);
    }
    return seconds;
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

    const counters = { generated: 0, errors: 0, skipped: 0, metaFilled: 0, metaErrors: 0 };

    // Two-level walk. A top-level read failure throws -> the job fails.
    const topEntries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
    topEntries
        .filter((dirent) => dirent.isDirectory())
        .filter((dirent) => streamFolders.has(dirent.name))
        .forEach((dirent) => {
            const folder = dirent.name;
            const outputFolder = path.join(AUDIO_DIR, folder);

            fs.readdirSync(outputFolder)
                .filter((file) => AUDIO_EXTS.has(path.extname(file)))
                .forEach((file) => {
                    // Derive the peak base from the REAL extension so <base>.json
                    // is correct for any codec (.mp3/.opus/.flac).
                    const fileExt = path.extname(file);
                    const filename = path.basename(file, fileExt);
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

                    const mp3FilePath = path.join(outputFolder, file);

                    if (!fs.existsSync(jsonFilePath)) {
                        try {
                            execFileSync('audiowaveform', audiowaveformArgs(mp3FilePath, jsonFilePath));
                            log.push(`Generated peak file: ${jsonFilePath}`);
                            counters.generated += 1;
                        } catch (error) {
                            log.push(
                                `Error executing audiowaveform for ${mp3FilePath}: ${error.message}`
                            );
                            counters.errors += 1;
                        }
                    }

                    // FEAT-003: fill duration + size on the recordings row. A
                    // per-file metadata failure is logged + counted, never fatal.
                    const parts = parseRecordingParts(file);
                    if (parts === null) {
                        return;
                    }
                    try {
                        const durationSeconds = module.exports.probeDurationSeconds(mp3FilePath);
                        const sizeBytes = fs.statSync(mp3FilePath).size;
                        upsertRecordingMeta(db, {
                            folder,
                            stamp: parts.stamp,
                            durationSeconds,
                            sizeBytes,
                            part: parts.part,
                            // The true on-disk extension so an INSERT builds the
                            // real-ext file_path (not a hard-coded .mp3).
                            ext: fileExt.slice(1),
                        });
                        counters.metaFilled += 1;
                    } catch (error) {
                        log.push(
                            `Error filling recording metadata for ${mp3FilePath}: ${error.message}`
                        );
                        counters.metaErrors += 1;
                    }
                });
        });

    log.push(
        `Peakfile done: ${counters.generated} generated, ${counters.skipped} skipped (no date pattern), ${counters.errors} error(s); ${counters.metaFilled} recording row(s) metadata-filled, ${counters.metaErrors} metadata error(s).`
    );
    return log.join('\n');
}

module.exports = { runPeakfileGenerator, probeDurationSeconds, currentHourStamp };
