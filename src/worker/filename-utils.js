// Pure helpers for parsing audio filenames, ported verbatim from
// src/peakfilegenerator/filename-utils.js.

// Extract the "YYYY-MM-DD-HH" date-time segment from a filename.
// Returns the matched string, or null when the filename has no such pattern.
function extractFileDateTime(filename) {
    const match = filename.match(/\d{4}-\d{2}-\d{2}-\d{2}/);
    return match === null ? null : match[0];
}

// `<folder>-YYYY-MM-DD-HH` then either `.<ext>` or `.part<N>.<ext>` where ext is
// one of the allowlisted codecs (mp3/opus/flac/aac — FEAT-002/FEAT-003). The folder segment
// is non-greedy up to the trailing date so folders may contain hyphens. Mirrors
// src/api/lib/recording-name.js and the recorder's segmentOutputName source of
// truth (.part2 == attempt 1).
const RECORDING_PARTS_RE =
    /-(\d{4}-\d{2}-\d{2}-\d{2})(?:\.part(\d+))?\.(mp3|opus|flac|aac)$/;

// Parse the hour stamp + segment part + extension from a recording filename.
// Returns { stamp: 'YYYY-MM-DD-HH', part, ext } where part is 1 for the primary
// file and 2+ for a `.partN` segment, or null when the name has no date pattern,
// an unknown/absent extension, or a nonsensical `.part0`/`.part1`. Pure, no fs.
//
// The three production callers (peakgen, cleaner, reconcile) always pass a real
// on-disk filename, which always carries a known extension; for them the
// extension is REQUIRED and returned. The ONLY bare-key (no-extension) use is a
// test affordance for grouping/keying by (stamp,part); pass
// { allowMissingExt: true } to accept a stamp-only name, in which case ext is
// returned as null (NEVER rebuild a filename from a null ext — design §5.6).
function parseRecordingParts(name, { allowMissingExt = false } = {}) {
    if (typeof name !== 'string') {
        return null;
    }

    let candidate = name;
    let bareKey = false;
    if (allowMissingExt && !/\.(mp3|opus|flac|aac)$/.test(name)) {
        // Normalise a stamp-only key to a parseable form; ext is reported null.
        candidate = `${name}.mp3`;
        bareKey = true;
    }

    const match = candidate.match(RECORDING_PARTS_RE);
    if (!match) {
        return null;
    }

    const [, stamp, partRaw, extRaw] = match;

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

    return { stamp, part, ext: bareKey ? null : extRaw };
}

module.exports = { extractFileDateTime, parseRecordingParts, RECORDING_PARTS_RE };
