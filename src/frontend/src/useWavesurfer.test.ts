import { describe, expect, it } from "vitest";
import { ZOOM_STEP, nextZoom } from "./useWavesurfer";

// Pure zoom-step math recovered from the old bundle: sign-only deltaY, fixed
// 5 px/sec step, lower clamp at 0, no upper clamp.
describe("nextZoom", () => {
  it("zooms in from the fit-to-container start (0)", () => {
    expect(nextZoom(0, -1)).toBe(ZOOM_STEP); // 5
  });

  it("zooms in by a fixed step regardless of deltaY magnitude", () => {
    expect(nextZoom(0, -999)).toBe(5);
    expect(nextZoom(5, -3)).toBe(10);
  });

  it("zooms out by a fixed step", () => {
    expect(nextZoom(10, 2)).toBe(5);
  });

  it("clamps the lower bound at 0 (never negative)", () => {
    expect(nextZoom(0, 1)).toBe(0);
    expect(nextZoom(3, 1)).toBe(0);
  });

  it("has no upper clamp (keeps increasing)", () => {
    expect(nextZoom(1000, -1)).toBe(1005);
  });
});
