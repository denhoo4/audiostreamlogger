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
 * argv for the ffprobe AAC frame-count probe (FEAT-001). A raw ADTS .aac has no
 * container duration, so `ffprobe format=duration` overshoots ~16x for 44.1 kHz
 * AAC. Instead we count the decoded audio frames and the stream sample rate and
 * derive the real length in the caller: for AAC-LC each frame is 1024 samples,
 * so seconds = nb_read_frames * 1024 / sample_rate. The path is a literal final
 * argv element (no shell).
 */
function ffprobeAacFrameCountArgs(inPath) {
    return [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-count_frames',
        '-show_entries',
        'stream=nb_read_frames,sample_rate',
        // KEYED output (no nk=1): ffprobe emits the two fields in its OWN
        // internal order (sample_rate before nb_read_frames), not the order
        // requested here, so the caller must parse by key name rather than by
        // position. noprint_wrappers drops the [STREAM]/[/STREAM] wrapper lines.
        '-of',
        'default=noprint_wrappers=1',
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
    ffprobeAacFrameCountArgs,
    ffmpegDecodeToWavArgs,
    audiowaveformStdinArgs,
};
