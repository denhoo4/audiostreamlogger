// Pure helper that builds the SAVED filename for a downloaded selection
// fragment. It is kept in its own module (not colocated in App.tsx) so it can be
// unit-tested without pulling in the WaveSurfer-heavy App module.
//
// The name format is `<streamname>_<start>_<end>.<ext>` with each timestamp
// rendered as `YYYY-MM-DD_HH-MM-SS` in absolute wall-clock time: the loaded
// recording's hour base plus the selection region's seconds-from-hour-start
// offset. The export REQUEST body is unrelated and is NOT built here.

/** The year/month/day/hour parts of the loaded recording (zero-padded strings). */
export interface RecordingBase {
  year: string;
  month: string;
  day: string;
  hour: string;
}

/** Zero-pad a non-negative integer to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format a Date's LOCAL wall-clock fields as `YYYY-MM-DD_HH-MM-SS`. Local
 * fields are used because the recording base is interpreted as a local
 * `YYYY-MM-DDTHH:00:00` instant and offsets are added in seconds, so the
 * rendered stamp reflects the same local clock the player shows.
 */
function formatStamp(d: Date): string {
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  return `${y}-${mo}-${day}_${h}-${mi}-${s}`;
}

/**
 * Build the saved fragment filename.
 *
 * @param streamname Safe base name (the stream folder is already `[a-z0-9_-]`).
 * @param base       The loaded recording's year/month/day/hour base.
 * @param startOffset Selection start, seconds from the hour base.
 * @param endOffset   Selection end, seconds from the hour base.
 * @param ext         File extension (the stream codec: mp3/opus/flac).
 * @returns `` `${streamname}_${startStamp}_${endStamp}.${ext}` ``.
 *
 * Offsets are rounded to the nearest second (matching the whole-second stamp
 * resolution). The absolute start/end instants are computed by adding the
 * offset seconds to the local hour base, so a selection that crosses the
 * hour/day boundary rolls the minute/hour/day over correctly.
 */
export function fragmentFilename(
  streamname: string,
  base: RecordingBase,
  startOffset: number,
  endOffset: number,
  ext: string,
): string {
  const baseDate = new Date(
    Number(base.year),
    Number(base.month) - 1,
    Number(base.day),
    Number(base.hour),
    0,
    0,
    0,
  );
  const start = new Date(baseDate.getTime() + Math.round(startOffset) * 1000);
  const end = new Date(baseDate.getTime() + Math.round(endOffset) * 1000);
  return `${streamname}_${formatStamp(start)}_${formatStamp(end)}.${ext}`;
}
