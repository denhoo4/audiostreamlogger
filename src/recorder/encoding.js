/**
 * Pure per-codec ffmpeg encoding resolver (FEAT-002).
 *
 * No ffmpeg, no DB, no fs — just a value-domain resolver so recorder.js can be
 * kept thin and this logic is unit-testable in isolation (mirrors the other
 * pure recorder helpers: time-helpers.js, backoff-helpers.js, catchup-helpers.js).
 *
 * `resolveEncoding(row)` clamps an unrecognised/NULL codec to the
 * behaviour-preserving mp3@160 default so a corrupt DB row can never produce an
 * un-encodable command — the recorder is the last line of defence; the api is
 * the authoritative validator (design §3/§7). `codec === ext` for all three
 * allowlisted codecs (mp3/opus/flac).
 *
 * `outputOptionsFor(enc)` returns the ffmpeg OUTPUT option ARRAY (never a shell
 * string — NFR-3) per design §6. The container/extension is implied by the
 * output filename extension (fluent-ffmpeg/ffmpeg pick the muxer from it):
 * .mp3->mp3, .opus->ogg (libopus), .flac->flac.
 */

// Behaviour-preserving default: exactly today's fixed encoding (libmp3lame,
// 160 kbps, 44100 Hz).
const DEFAULT_CODEC = 'mp3';
const DEFAULT_BITRATE_KBPS = 160;

// Fixed output sample rate, preserved for mp3/flac (today's `-ar 44100`).
const SAMPLE_RATE = 44100;

// libopus only accepts 8000/12000/16000/24000/48000 Hz and rejects 44100 with
// "Specified sample rate 44100 is not supported" — which would crash the
// recorder on every opus capture. Opus is internally 48 kHz, so we pin opus
// output to its native 48000 Hz. (The browser/HTMLAudioElement resamples on
// playback; sample rate is not a user-facing control — design §"Non-goals".)
const OPUS_SAMPLE_RATE = 48000;

// Allowlist mirrors src/api/lib/validate-stream.js CODECS (value domain owned by
// the api; duplicated here as a trivial constant like the other cross-service
// pure helpers). `ext === codec` for all three.
const CODECS = {
    mp3: { ext: 'mp3', kind: 'lossy', bitrates: [96, 128, 160, 192, 256, 320] },
    opus: { ext: 'opus', kind: 'lossy', bitrates: [64, 96, 128, 160, 192] },
    flac: { ext: 'flac', kind: 'lossless', bitDepths: [16, 24] },
};

// Resolve a stream row to { codec, ext, bitrate_kbps, bit_depth } defensively.
// An unrecognised/NULL/non-string codec clamps to the mp3@160 default. For a
// lossy codec with a missing/out-of-set bitrate, fall back to the default
// bitrate (160 for mp3/opus — still in opus' set). For flac with a missing/bad
// bit_depth, fall back to 16. `clamped` is true when the codec itself was not a
// recognised allowlist entry (so the caller can emit the greppable warn line).
function resolveEncoding(row) {
    const raw = row || {};
    const codec = typeof raw.codec === 'string' ? raw.codec : null;
    const entry = codec !== null ? CODECS[codec] : undefined;

    if (entry === undefined) {
        return {
            codec: DEFAULT_CODEC,
            ext: CODECS[DEFAULT_CODEC].ext,
            bitrate_kbps: DEFAULT_BITRATE_KBPS,
            bit_depth: null,
            clamped: true,
        };
    }

    if (entry.kind === 'lossy') {
        const bitrate = Number(raw.bitrate_kbps);
        const bitrate_kbps = entry.bitrates.includes(bitrate)
            ? bitrate
            : DEFAULT_BITRATE_KBPS;
        return { codec, ext: entry.ext, bitrate_kbps, bit_depth: null, clamped: false };
    }

    // Lossless (flac): resolve bit_depth from {16,24}, default 16.
    const depth = Number(raw.bit_depth);
    const bit_depth = entry.bitDepths.includes(depth) ? depth : 16;
    return { codec, ext: entry.ext, bitrate_kbps: null, bit_depth, clamped: false };
}

// Build the ffmpeg OUTPUT option ARRAY for a resolved encoding (design §6):
//   mp3  -> -c:a libmp3lame -b:a <n>k -ar 44100
//   opus -> -c:a libopus    -b:a <n>k -ar 48000  (libopus rejects 44100)
//   flac -> -c:a flac -ar 44100  (+ -sample_fmt s16  for 16-bit
//                                 | -sample_fmt s32 -bits_per_raw_sample 24  for 24-bit)
// Returns a flat array of args (never a shell string — NFR-3).
function outputOptionsFor(enc) {
    const e = enc || resolveEncoding(null);
    if (e.codec === 'opus') {
        // libopus rejects 44100 Hz; pin to its native 48000 Hz (see OPUS_SAMPLE_RATE).
        return ['-c:a', 'libopus', '-b:a', `${e.bitrate_kbps}k`, '-ar', String(OPUS_SAMPLE_RATE)];
    }
    if (e.codec === 'flac') {
        const opts = ['-c:a', 'flac', '-ar', String(SAMPLE_RATE)];
        if (e.bit_depth === 24) {
            opts.push('-sample_fmt', 's32', '-bits_per_raw_sample', '24');
        } else {
            opts.push('-sample_fmt', 's16');
        }
        return opts;
    }
    // Default / mp3.
    return ['-c:a', 'libmp3lame', '-b:a', `${e.bitrate_kbps}k`, '-ar', String(SAMPLE_RATE)];
}

module.exports = {
    resolveEncoding,
    outputOptionsFor,
    CODECS,
    DEFAULT_CODEC,
    DEFAULT_BITRATE_KBPS,
    SAMPLE_RATE,
    OPUS_SAMPLE_RATE,
};
