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

// Pure decision for the current hour of ONE stream (FEAT-002). Replaces the old
// "primary file exists -> skip, else start" predicate with an .inprogress-aware
// decision the catch-up/poll acts on:
//   - 'skip'   : the hour is already finalised (primary file present) OR an
//                in-progress capture for this hour is ACTIVELY running in this
//                process — nothing to start.
//   - 'resume' : neither of the above — there is no finalised file and no live
//                capture, so start/top-up a remainder-of-the-hour fragment
//                (a brand-new hour, or an .inprogress dir left by a crashed/
//                rebooted capture whose [lastClosed..now] gap finalises to
//                silence; the two are the same action — append a fragment now).
// `facts` = { hasPrimary, isActivelyCapturing } booleans supplied by the
// caller (recorder.js owns the fs existsSync + the runtime `active` map). No fs,
// no DB here so it unit-tests in isolation.
function currentHourDecision({ hasPrimary = false, isActivelyCapturing = false } = {}) {
    if (hasPrimary || isActivelyCapturing) {
        return 'skip';
    }
    return 'resume';
}

module.exports = { streamsNeedingCatchup, currentHourDecision };
