// Pure helpers for parsing audio filenames, ported verbatim from
// src/peakfilegenerator/filename-utils.js.

// Extract the "YYYY-MM-DD-HH" date-time segment from a filename.
// Returns the matched string, or null when the filename has no such pattern.
function extractFileDateTime(filename) {
    const match = filename.match(/\d{4}-\d{2}-\d{2}-\d{2}/);
    return match === null ? null : match[0];
}

// `<folder>-YYYY-MM-DD-HH` then either `.mp3` or `.part<N>.mp3`. The folder
// segment is non-greedy up to the trailing date so folders may contain hyphens.
// Mirrors src/api/lib/recording-name.js (FEAT-001) and the recorder's
// segmentOutputName source of truth (.part2 == attempt 1).
const RECORDING_PARTS_RE =
    /-(\d{4}-\d{2}-\d{2}-\d{2})(?:\.part(\d+))?\.mp3$/;

// Parse the hour stamp + segment part from a recording filename. Returns
// { stamp: 'YYYY-MM-DD-HH', part } where part is 1 for the primary file and 2+
// for a `.partN` segment, or null when the name has no date pattern (or carries
// a nonsensical `.part0`/`.part1`). Pure, no fs. Accepts either the bare
// basename or a name with the `.mp3` extension still attached.
function parseRecordingParts(name) {
    if (typeof name !== 'string') {
        return null;
    }
    // Normalise to an `...mp3` form so one regex handles both callers.
    const withExt = name.endsWith('.mp3') ? name : `${name}.mp3`;
    const match = withExt.match(RECORDING_PARTS_RE);
    if (!match) {
        return null;
    }

    const [, stamp, partRaw] = match;

    let part;
    if (partRaw === undefined) {
        part = 1;
    } else {
        const n = Number(partRaw);
        if (!Number.isInteger(n) || n < 2) {
            return null;
        }
        part = n;
    }

    return { stamp, part };
}

module.exports = { extractFileDateTime, parseRecordingParts };
