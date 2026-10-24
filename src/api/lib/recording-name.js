/**
 * Pure parser for recorded-audio filenames (no fs, no DB) — FEAT-001.
 *
 * The recorder's single source of truth for the on-disk name is
 * src/recorder/backoff-helpers.js::segmentOutputName:
 *   primary (attempt 0):      `<folder>-YYYY-MM-DD-HH.<ext>`
 *   mid-hour restart (>=1):   `<folder>-YYYY-MM-DD-HH.part<n+1>.<ext>`  (.part2 == attempt 1)
 * where `<ext>` is one of the allowlisted codecs (mp3/opus/flac — FEAT-002).
 *
 * parseRecordingFilename(name) returns
 *   { folder, date ('YYYY-MM-DD'), hour ('HH'), part, ext } | null
 * where `part` is 1 for the primary file and 2+ for a `.partN` segment and `ext`
 * is the matched codec extension. A name with no date pattern, an unknown/absent
 * extension, or a `.partN` where N is not an integer >= 2 yields null.
 */

// `<folder>-YYYY-MM-DD-HH` then either `.<ext>` or `.part<N>.<ext>`. The folder
// segment is non-greedy up to the trailing date so folders may contain hyphens.
const RECORDING_NAME_RE =
    /^(.+)-(\d{4}-\d{2}-\d{2})-(\d{2})(?:\.part(\d+))?\.(mp3|opus|flac)$/;

function parseRecordingFilename(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const match = name.match(RECORDING_NAME_RE);
    if (!match) {
        return null;
    }

    const [, folder, date, hour, partRaw, ext] = match;

    let part;
    if (partRaw === undefined) {
        // No `.partN` suffix => the primary file for the hour.
        part = 1;
    } else {
        // `.partN` with N an integer >= 2 (part2 == recorder attempt 1). A
        // nonsensical `.part0`/`.part1` is treated as not a recording name.
        const n = Number(partRaw);
        if (!Number.isInteger(n) || n < 2) {
            return null;
        }
        part = n;
    }

    return { folder, date, hour, part, ext };
}

module.exports = { parseRecordingFilename };
