import { describe, expect, it } from "vitest";
import { fragmentFilename } from "./player-filename";

// The saved fragment name is `<streamname>_<start>_<end>.<ext>` with each
// timestamp rendered as `YYYY-MM-DD_HH-MM-SS` in absolute wall-clock time:
// recording hour base + the region's seconds-from-hour-start offset.
describe("fragmentFilename", () => {
  const base = { year: "2026", month: "10", day: "23", hour: "09" };

  it("builds the stamped name from offsets within the hour", () => {
    // start 5.4s -> round 5s -> 09:00:05; end 75.6s -> round 76s -> 09:01:16.
    expect(fragmentFilename("radio_one", base, 5.4, 75.6, "mp3")).toBe(
      "radio_one_2026-10-23_09-00-05_2026-10-23_09-01-16.mp3",
    );
  });

  it("rolls over the hour (and day) boundary when the offset crosses it", () => {
    // start at 59:30 of hour 09 -> 09:59:30; end 3600s + 45s past the base ->
    // 10:00:45. Same day.
    expect(fragmentFilename("radio_one", base, 3570, 3645, "mp3")).toBe(
      "radio_one_2026-10-23_09-59-30_2026-10-23_10-00-45.mp3",
    );
  });

  it("rolls the day over when a selection in hour 23 crosses midnight", () => {
    const lateBase = { year: "2026", month: "10", day: "23", hour: "23" };
    // start 59:00 of hour 23 -> 23-59-00; end 90s after the base hour start ->
    // next day 00-01-30.
    expect(fragmentFilename("radio_one", lateBase, 3540, 3690, "mp3")).toBe(
      "radio_one_2026-10-23_23-59-00_2026-10-24_00-01-30.mp3",
    );
  });

  it("passes the codec extension through unchanged", () => {
    expect(fragmentFilename("s", base, 0, 1, "opus")).toBe(
      "s_2026-10-23_09-00-00_2026-10-23_09-00-01.opus",
    );
    expect(fragmentFilename("s", base, 0, 1, "flac")).toBe(
      "s_2026-10-23_09-00-00_2026-10-23_09-00-01.flac",
    );
  });
});
