/**
 * buildSettings2(db): the /settings2 browse-tree source.
 *
 * Reads streams from the DB (replacing the old settings.json read), scans
 * audio/<folder> per stream for recorded hours (reusing the ENOENT->{} handling
 * that lets a freshly deployed stack with no recordings yet still respond), then
 * folds the result into the nested browse tree via buildBrowseTree.
 *
 * NOTE: the leaking `test` field that the old inline handler attached to each
 * station is intentionally NOT reproduced here (design FR-6 / AC-11).
 */
const fs = require('fs');
const path = require('path');
const { buildBrowseTree } = require('../lib/settings-transform');
const { listStreams } = require('./streams');

const AUDIO_BASE_DIR = path.join(__dirname, '../audio');

// The recorder's hidden per-stream live-preview dir (mirrors
// src/recorder/live-preview.js LIVE_DIR). It holds the current hour's
// non-canonical preview `<stamp>.<ext>`; browse surfaces that hour so the
// player can offer the still-growing current hour before its canonical primary
// is finalised. The `.live` dir itself stays excluded from the primary file
// scan (the primary regex never matches a bare `<stamp>.<ext>`).
const LIVE_DIR = '.live';

/**
 * Scan a single stream folder for recorded hours, grouped
 * year -> month -> day -> [hours]. A folder that does not exist yet (the
 * recorder has not written its first file) yields {} rather than an error.
 * In addition to the finalised primary files, the current hour is surfaced
 * whenever a `.live/<stamp>.<ext>` preview exists (FEAT-002) so the live hour is
 * selectable before its canonical primary is written.
 */
async function folderContent(folderPath) {
    try {
        let files;
        try {
            files = await fs.promises.readdir(folderPath);
        } catch (err) {
            if (err.code === 'ENOENT') {
                return {};
            }
            throw err;
        }

        const dateMap = new Map();

        // Add a `YYYY-MM-DD-HH`-derived hour into the nested year/month/day map.
        const addHour = (year, month, day, hour) => {
            if (!dateMap.has(year)) {
                dateMap.set(year, new Map());
            }

            const yearMap = dateMap.get(year);

            if (!yearMap.has(month)) {
                yearMap.set(month, new Map());
            }

            const monthMap = yearMap.get(month);

            if (!monthMap.has(day)) {
                monthMap.set(day, new Set());
            }

            monthMap.get(day).add(hour);
        };

        files.forEach((file) => {
            const match = file.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})\.(?:mp3|opus|aac|flac)$/);
            if (match) {
                const [year, month, day, hour] = match.slice(1);
                addHour(year, month, day, hour);
            }
        });

        // Also surface the current hour from the live-preview dir (FEAT-002).
        // A missing `.live` dir (no preview yet) is skipped (ENOENT), never an
        // error. Each preview is a bare `<stamp>.<ext>`; the stamp's hour is
        // folded into the same map as a primary file so existingHoursFor/
        // existingDaysFor offer the live hour.
        try {
            const liveFiles = await fs.promises.readdir(path.join(folderPath, LIVE_DIR));
            liveFiles.forEach((file) => {
                const match = file.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.(?:mp3|opus|aac|flac)$/);
                if (match) {
                    const [year, month, day, hour] = match.slice(1);
                    addHour(year, month, day, hour);
                }
            });
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }

        const result = {};

        for (const [year, yearMap] of dateMap) {
            result[year] = {};

            for (const [month, monthMap] of yearMap) {
                result[year][month] = {};

                for (const [day, daySet] of monthMap) {
                    result[year][month][day] = Array.from(daySet);
                }
            }
        }

        return result;
    } catch (err) {
        console.error(`Error reading folder: ${err}`);
        throw err;
    }
}

/**
 * Build the /settings2 response: DB streams + per-folder audio scan -> tree.
 */
async function buildSettings2() {
    const streams = listStreams();

    const stations = await Promise.all(
        streams.map(async (stream) => {
            const folderPath = path.join(AUDIO_BASE_DIR, stream.folder);
            const logs = await folderContent(folderPath);
            // Only the fields buildBrowseTree needs; no leaking `test` field.
            return { name: stream.name, logs };
        })
    );

    return buildBrowseTree(stations);
}

module.exports = { buildSettings2, folderContent };
