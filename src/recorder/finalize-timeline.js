/**
 * Pure, side-effect-free hour-timeline builder (Phase 0 — FEAT-001).
 *
 * No fs, no ffmpeg, no DB — a value-domain helper so recorder.js stays thin and
 * this logic is unit-testable in isolation (mirrors time-helpers.js /
 * backoff-helpers.js / encoding.js).
 *
 * `buildTimeline(fragments, hourSeconds=3600)` tiles the closed interval
 * [0, hourSeconds] from offset-tagged capture fragments, inserting an explicit
 * SILENCE segment for every gap: leading silence when the first fragment starts
 * after 0, interior silence between fragments, and trailing silence out to
 * hourSeconds. The result is the contract the finalise ffmpeg runner consumes:
 * an ordered list of segments whose summed durationSeconds is EXACTLY
 * hourSeconds, so the finalised hour file is always precisely one hour long with
 * gaps represented as silence rather than a short/overlong file.
 *
 * Input fragment shape (seconds from top-of-hour):
 *   { startOffset, plannedDuration?|actualDuration?, file, ext? }
 *   - startOffset: seconds from the top of the hour the fragment begins at.
 *   - actualDuration (preferred) or plannedDuration: fragment length in seconds.
 *   - file: the fragment's on-disk path (passed through unchanged for ffmpeg).
 *   - ext: optional codec extension (passed through unchanged when present).
 *
 * Output segment shape:
 *   { kind: 'silence', durationSeconds }
 *   { kind: 'fragment', durationSeconds, file, ext? }
 *
 * Normalisation rules:
 *   - sort fragments by startOffset (ascending);
 *   - drop fragments that are not usable (no file, non-finite/<=0 duration,
 *     startOffset >= hourSeconds);
 *   - clamp a startOffset < 0 up to 0;
 *   - clamp an over-long fragment so it never runs past hourSeconds;
 *   - clamp OVERLAPS: a fragment that starts before the previous fragment ended
 *     is trimmed from its front so segments never overlap (cursor only advances);
 *   - empty / all-dropped input -> a single full-hour silence segment.
 */

function buildTimeline(fragments, hourSeconds = 3600) {
    const total = Number.isFinite(hourSeconds) && hourSeconds > 0 ? hourSeconds : 3600;

    // Normalise + keep only usable fragments, then sort by startOffset.
    const usable = (Array.isArray(fragments) ? fragments : [])
        .map((f) => {
            const frag = f || {};
            const start = Number(frag.startOffset);
            const dur = Number(
                frag.actualDuration != null ? frag.actualDuration : frag.plannedDuration,
            );
            return {
                start: Number.isFinite(start) ? Math.max(0, start) : NaN,
                duration: dur,
                file: frag.file,
                ext: frag.ext,
            };
        })
        .filter(
            (f) =>
                typeof f.file === 'string' &&
                f.file.length > 0 &&
                Number.isFinite(f.start) &&
                f.start < total &&
                Number.isFinite(f.duration) &&
                f.duration > 0,
        )
        .sort((a, b) => a.start - b.start);

    const segments = [];
    let cursor = 0; // seconds already tiled from the top of the hour

    for (const f of usable) {
        // Front-clamp overlaps: never place a fragment before the cursor.
        const start = Math.max(f.start, cursor);
        // End-clamp to the hour boundary and compute how much of the fragment
        // still contributes once overlap/boundary clamping is applied.
        const end = Math.min(f.start + f.duration, total);
        const effective = end - start;
        if (effective <= 0) {
            // Fully overlapped by prior fragments or already past the hour — drop.
            continue;
        }

        // Interior/leading gap before this fragment -> silence.
        if (start > cursor) {
            segments.push({ kind: 'silence', durationSeconds: start - cursor });
            cursor = start;
        }

        const seg = { kind: 'fragment', durationSeconds: effective, file: f.file };
        if (f.ext !== undefined) {
            seg.ext = f.ext;
        }
        segments.push(seg);
        cursor = end;
    }

    // Trailing silence (also covers the empty-input case: cursor stays 0).
    if (cursor < total) {
        segments.push({ kind: 'silence', durationSeconds: total - cursor });
    }

    return segments;
}

/**
 * Pure fragment-validation gate (hotfix — RC2).
 *
 * A per-hour sidecar `state.json` ledger can reference a fragment file that was
 * never written to disk (or was lost), e.g. `956-0.mp3`. Feeding such a name
 * straight into `buildTimeline` keeps it on the timeline, and ffmpeg then exits
 * 1 with "`956-0.mp3`: No such file or directory", which (pre-hotfix) crashed
 * the recorder. This helper drops any fragment whose file does NOT pass the
 * injected `existsAndNonEmpty(file) -> boolean` predicate BEFORE the timeline is
 * built. Because `buildTimeline` turns every uncovered time-range into silence,
 * dropping a missing fragment automatically WIDENS the surrounding silence to
 * cover its offset range, so the finalised hour stays exactly 3600s with no
 * extra math.
 *
 * Kept PURE (the fs stat is the injected predicate, supplied by the caller) so
 * it unit-tests in isolation like the rest of this module. Fragments without a
 * usable string `file` are passed through unchanged — `buildTimeline` already
 * drops those — so this helper only ever removes fragments the predicate
 * rejects.
 *
 * @param {Array}    fragments         raw sidecar fragment list.
 * @param {function} existsAndNonEmpty predicate: (file) => boolean.
 * @returns {Array} the fragments whose file passed (or had no string file).
 */
function filterUsableFragments(fragments, existsAndNonEmpty) {
    const list = Array.isArray(fragments) ? fragments : [];
    const predicate = typeof existsAndNonEmpty === 'function' ? existsAndNonEmpty : () => true;
    return list.filter((frag) => {
        const file = frag && frag.file;
        if (typeof file !== 'string' || file.length === 0) {
            // No usable file reference — buildTimeline drops it anyway; leave the
            // decision to buildTimeline rather than stat a non-string.
            return true;
        }
        return predicate(file) === true;
    });
}

module.exports = { buildTimeline, filterUsableFragments };
