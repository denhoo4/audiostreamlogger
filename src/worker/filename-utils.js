// Pure helpers for parsing audio filenames, ported verbatim from
// src/peakfilegenerator/filename-utils.js.

// Extract the "YYYY-MM-DD-HH" date-time segment from a filename.
// Returns the matched string, or null when the filename has no such pattern.
function extractFileDateTime(filename) {
    const match = filename.match(/\d{4}-\d{2}-\d{2}-\d{2}/);
    return match === null ? null : match[0];
}

module.exports = { extractFileDateTime };
