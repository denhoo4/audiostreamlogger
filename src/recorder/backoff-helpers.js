// Pure, side-effect-free helpers for the per-stream recorder supervisor.
// Kept in a separate module (mirroring time-helpers.js) so tests can require
// them without triggering recorder.js's boot side effects (DB read, cron
// register, signal handlers). No fs, no ffmpeg, no requiring recorder.js.

// Capped exponential backoff delay for restart attempt `attempt` (0-based).
// Grows as baseMs * 2**attempt, clamped into [baseMs, capMs]. A 0 or negative
// attempt is treated as 0 (returns baseMs); a very large attempt saturates at
// capMs without overflowing to Infinity. Guarantees a sane positive delay so
// the supervisor never busy-loops.
function backoffDelayMs(attempt, { baseMs, capMs }) {
    const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
    // Cap the exponent so 2**n cannot overflow to Infinity for huge attempts;
    // once baseMs * 2**n exceeds capMs the result is capMs anyway.
    const exponent = Math.min(n, 1023);
    const raw = baseMs * Math.pow(2, exponent);
    const clamped = Math.min(capMs, raw);
    return Math.max(baseMs, clamped);
}

// True only when more than `floorSeconds` remain in the current hour, meaning a
// mid-hour restart is still worth scheduling. Once the remaining time drops to
// the floor (or below), the hour is about to roll over and the next hourly cron
// tick takes over, so no restart is scheduled.
function shouldRestartWithinHour(remainingSeconds, floorSeconds) {
    return remainingSeconds > floorSeconds;
}

// Output filename for a given restart attempt (D2 in the plan). Attempt 0 keeps
// the EXACT current name `<folder>-<stamp>.<ext>` so the normal/catch-up path and
// all downstream consumers are unchanged. A mid-hour restart (attempt >= 1)
// writes a distinct same-hour segment `<folder>-<stamp>.part<attempt+1>.<ext>`
// (.part2, .part3, ...) so it never overwrites audio already captured.
//
// `ext` is the per-stream codec extension (mp3/opus/flac resolved via
// encoding.js); it defaults to 'mp3' so existing call sites and tests that omit
// it stay on today's behaviour (FEAT-002, design §5.1).
function segmentOutputName(folder, stamp, attempt, ext = 'mp3') {
    const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
    if (n === 0) {
        return `${folder}-${stamp}.${ext}`;
    }
    return `${folder}-${stamp}.part${n + 1}.${ext}`;
}

module.exports = { backoffDelayMs, shouldRestartWithinHour, segmentOutputName };
