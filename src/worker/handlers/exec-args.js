/**
 * Pure argv-array builders for the external binaries the peakfilegenerator
 * handler shells out to. Returning an ARRAY (never a shell string) lets the
 * handler use execFileSync, so file paths are passed as literal arguments and
 * never go through a shell — no quoting, no interpolation, no injection.
 *
 * These functions are intentionally pure (no I/O, no child_process) so they can
 * be unit-tested without invoking the real binaries.
 */

/**
 * argv for `audiowaveform -i <in> -o <out> --pixels-per-second 20 --bits 8`.
 * Same flags, same order as the previous shell command; only the shell +
 * string-quoting layer is gone.
 */
function audiowaveformArgs(inPath, outPath) {
    return ['-i', inPath, '-o', outPath, '--pixels-per-second', '20', '--bits', '8'];
}

/**
 * argv for the ffprobe duration probe. Matches the previous shell command
 * (`ffprobe -v error -show_entries format=duration -of
 * default=nk=1:noprint_wrappers=1 <in>`) with the path as a literal final arg.
 */
function ffprobeDurationArgs(inPath) {
    return [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=nk=1:noprint_wrappers=1',
        inPath,
    ];
}

module.exports = { audiowaveformArgs, ffprobeDurationArgs };
