/**
 * Hour-finalise ffmpeg runner (Phase 0 — FEAT-001).
 *
 * The pure argv BUILDERS have no fs/DB/child_process so they unit-test in
 * isolation (mirrors encoding.js / exec-args.js). `finalizeHour` is the only
 * impure surface: a thin spawn runner that selects a builder and resolves on a
 * clean ffmpeg exit. Every ffmpeg option is passed as an ARRAY element — never
 * a shell string (NFR-3) — so paths are literal argv and never hit a shell.
 *
 * Two output paths, both producing a file whose duration is EXACTLY 3600s:
 *
 *  1. buildConcatFinalizeArgs(segments, enc): the general path. Each timeline
 *     segment (from finalize-timeline.buildTimeline) becomes one ffmpeg input —
 *     a SILENCE segment is a lavfi `anullsrc` source of its exact duration, a
 *     FRAGMENT segment is its on-disk file. A `concat=n=K:v=0:a=1` filter tiles
 *     them in order, then an in-graph `apad` + output `-t 3600` pads/trims to an
 *     exact hour with a clean header, re-encoded via encoding.outputOptionsFor(enc).
 *     (apad lives in the filtergraph because ffmpeg forbids `-af` alongside
 *     `-filter_complex` on one stream; the net result is the same.) anullsrc
 *     sample_rate matches the codec (48000 for opus, else 44100) so the concat
 *     filter never has to resample a mismatched silence source. Used for mp3,
 *     opus, flac, and the AAC WITH-GAP case (silence forces a transcode).
 *
 *  2. buildCopyRemuxArgs(fragmentFile, enc): the AAC no-gap FAST path. A single
 *     unbroken copy-eligible fragment is stream-copied (no resample, no
 *     re-encode) and remuxed to a clean raw-ADTS hour: `-fflags +genpts -i
 *     <frag> -c copy -t 3600 -f adts`. Only reached when enc.codec === 'aac'.
 *
 * finalizeHour(workDir, outPath, enc, options) inspects the timeline it is
 * given and picks the copy-remux fast path only when enc.codec === 'aac' AND
 * the timeline is a single fragment segment with NO silence; otherwise it uses
 * the concat builder. It returns a promise that resolves when ffmpeg exits 0
 * and rejects on a non-zero exit or spawn error.
 */

const { spawn } = require('child_process');
const { outputOptionsFor, OPUS_SAMPLE_RATE, SAMPLE_RATE } = require('./encoding');

const HOUR_SECONDS = 3600;

// lavfi silence sample rate for a resolved encoding: opus is natively 48 kHz
// (libopus rejects 44100), everything else uses 44100 so the silence source
// matches the fragments and the concat filter never resamples.
function silenceSampleRate(enc) {
    return enc && enc.codec === 'opus' ? OPUS_SAMPLE_RATE : SAMPLE_RATE;
}

/**
 * Build the ffmpeg argv for the general concat-with-silence finalise path.
 *
 * `segments` is the ordered timeline from buildTimeline: each
 * `{ kind:'silence', durationSeconds }` becomes a lavfi anullsrc input of that
 * duration, each `{ kind:'fragment', file }` becomes a file input. A
 * concat=n=K:v=0:a=1 filter joins them in input order, then `-af apad -t 3600`
 * guarantees an exact-hour output. Returns a flat argv ARRAY (no shell string).
 */
function buildConcatFinalizeArgs(segments, enc, hourSeconds = HOUR_SECONDS) {
    const segs = Array.isArray(segments) ? segments : [];
    const sr = silenceSampleRate(enc);

    const inputArgs = [];
    const concatLabels = [];
    let inputIndex = 0;

    for (const seg of segs) {
        if (seg.kind === 'silence') {
            // A finite-duration silence source at the codec's sample rate.
            inputArgs.push(
                '-f',
                'lavfi',
                '-t',
                String(seg.durationSeconds),
                '-i',
                `anullsrc=channel_layout=stereo:sample_rate=${sr}`,
            );
        } else {
            inputArgs.push('-i', seg.file);
        }
        concatLabels.push(`[${inputIndex}:a]`);
        inputIndex += 1;
    }

    const n = concatLabels.length;
    // apad is folded INTO the filtergraph (concat -> apad): ffmpeg refuses to
    // combine `-af` with `-filter_complex` on the same output stream, so the
    // pad belongs in the complex graph. `-t <hourSeconds>` then trims the padded
    // stream to an exact hour. Net effect is identical to "concat then apad -t".
    const filter = `${concatLabels.join('')}concat=n=${n}:v=0:a=1,apad[out]`;

    return [
        '-y',
        ...inputArgs,
        '-filter_complex',
        filter,
        '-map',
        '[out]',
        '-t',
        String(hourSeconds),
        ...outputOptionsFor(enc),
    ];
}

/**
 * Build the ffmpeg argv for the AAC no-gap copy-remux fast path: stream-copy a
 * single unbroken copy-eligible fragment into a clean, exactly-one-hour raw
 * ADTS file with NO resample and NO re-encode. `-fflags +genpts` regenerates
 * timestamps so the remux header is clean; `-t 3600` trims/anchors the hour;
 * `-f adts` pins the raw-ADTS muxer. Returns a flat argv ARRAY.
 */
function buildCopyRemuxArgs(fragmentFile, enc, hourSeconds = HOUR_SECONDS) {
    return [
        '-y',
        '-fflags',
        '+genpts',
        '-i',
        fragmentFile,
        '-c',
        'copy',
        '-t',
        String(hourSeconds),
        '-f',
        'adts',
    ];
}

// True when the timeline is a single fragment segment with no silence — the
// only shape eligible for the AAC copy-remux fast path.
function isSingleUnbrokenFragment(segments) {
    return (
        Array.isArray(segments) &&
        segments.length === 1 &&
        segments[0] &&
        segments[0].kind === 'fragment' &&
        typeof segments[0].file === 'string'
    );
}

/**
 * Run ffmpeg to finalise one hour.
 *
 * @param {string} workDir      cwd for ffmpeg (fragment paths may be relative to it).
 * @param {string} outPath      the hour output file ffmpeg writes.
 * @param {object} enc          resolved encoding (encoding.resolveEncoding).
 * @param {object} options
 * @param {Array}  options.segments   timeline from buildTimeline (required).
 * @param {number} [options.hourSeconds=3600]
 * @param {string} [options.ffmpegPath='ffmpeg']  binary to spawn (test override).
 * @returns {Promise<{mode:string}>} resolves on ffmpeg exit 0.
 */
function finalizeHour(workDir, outPath, enc, options = {}) {
    const segments = Array.isArray(options.segments) ? options.segments : [];
    const hourSeconds = Number.isFinite(options.hourSeconds) ? options.hourSeconds : HOUR_SECONDS;
    const ffmpegPath = options.ffmpegPath || 'ffmpeg';

    const copyEligible = enc && enc.codec === 'aac' && isSingleUnbrokenFragment(segments);

    let args;
    let mode;
    if (copyEligible) {
        mode = 'copy-remux';
        args = buildCopyRemuxArgs(segments[0].file, enc, hourSeconds);
    } else {
        mode = 'concat';
        args = buildConcatFinalizeArgs(segments, enc, hourSeconds);
    }
    args.push(outPath);

    return new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { cwd: workDir });
        let stderr = '';
        if (child.stderr) {
            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
        }
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ mode });
            } else {
                reject(new Error(`ffmpeg finalise exited ${code}: ${stderr.slice(-2000)}`));
            }
        });
    });
}

module.exports = {
    buildConcatFinalizeArgs,
    buildCopyRemuxArgs,
    finalizeHour,
    HOUR_SECONDS,
};
