// Pure, side-effect-free helper for the recorder's catch-up logic (startup
// catch-up AND the periodic new-stream poll). Kept out of recorder.js (mirroring
// time-helpers.js / backoff-helpers.js) so it can be unit-tested without
// triggering recorder.js's boot side effects. No fs, no DB, no ffmpeg here: the
// caller supplies the stream list and a predicate that answers "does a current
// hour recording already exist for this folder?".

// Given the current stream list and a `hasRecording(folder)` predicate, return
// the subset of streams that have NO recording file for the current hour yet
// and therefore need a remainder-of-the-hour catch-up recording started. This
// is the single source of truth for the "exists = skip" rule shared by the
// startup catch-up and the periodic poll: a brand-new stream (no file yet) is
// selected, while a stream already recording/recorded this hour is skipped.
function streamsNeedingCatchup(streams, hasRecording) {
    if (!Array.isArray(streams)) {
        return [];
    }
    return streams.filter((item) => !hasRecording(item.folder));
}

module.exports = { streamsNeedingCatchup };
