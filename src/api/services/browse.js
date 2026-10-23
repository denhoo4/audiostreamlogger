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

/**
 * Scan a single stream folder for recorded hours, grouped
 * year -> month -> day -> [hours]. A folder that does not exist yet (the
 * recorder has not written its first file) yields {} rather than an error.
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

        files.forEach((file) => {
            const match = file.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})\.mp3$/);
            if (match) {
                const [year, month, day, hour] = match.slice(1);

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

                const daySet = monthMap.get(day);
                daySet.add(hour);
            }
        });

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
