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

/**
 * argv for `ffmpeg -i <in> -f wav -` (FEAT-003). audiowaveform 1.10.2 cannot
 * read a raw ADTS .aac directly, so for .aac ONLY we decode to a WAV stream on
 * stdout and pipe it into audiowaveform (see audiowaveformStdinArgs). The path
 * is a literal argv element; the WAV is written to stdout (`-`).
 */
function ffmpegDecodeToWavArgs(inPath) {
    return ['-i', inPath, '-f', 'wav', '-'];
}

/**
 * argv for `audiowaveform --input-format wav -i - -o <out> --pixels-per-second
 * 20 --bits 8` (FEAT-003). Same flags/values as audiowaveformArgs but reads the
 * decoded WAV from stdin (`-i -`) with an explicit `--input-format wav`, since
 * the input no longer has a filename extension to infer the format from.
 */
function audiowaveformStdinArgs(outPath) {
    return [
        '--input-format',
        'wav',
        '-i',
        '-',
        '-o',
        outPath,
        '--pixels-per-second',
        '20',
        '--bits',
        '8',
    ];
}

module.exports = {
    audiowaveformArgs,
    ffprobeDurationArgs,
    ffmpegDecodeToWavArgs,
    audiowaveformStdinArgs,
};
