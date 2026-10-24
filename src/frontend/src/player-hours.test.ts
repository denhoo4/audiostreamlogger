import { describe, expect, it } from "vitest";
import { displayNameForFolder, existingHoursFor } from "./player-hours";
import type { Settings2, Stream } from "./api";

const STREAMS: Stream[] = [
  {
    country: "NL",
    name: "Glow FM",
    folder: "glowfm",
    url: "http://x/1",
    codec: "mp3",
  },
  {
    country: "NL",
    name: "Sublime",
    folder: "sublime",
    url: "http://x/2",
    codec: "mp3",
  },
];

// Tree keyed by the stored station name verbatim (station -> year -> month ->
// day -> hours[]), matching the GET /api/settings2 runtime shape.
const TREE: Settings2 = {
  "Glow FM": {
    "2026": {
      "10": {
        "23": ["15", "09", "14"],
      },
    },
  } as unknown as Settings2[string],
};

describe("displayNameForFolder", () => {
  it("returns the stored name verbatim for a known folder", () => {
    expect(displayNameForFolder(STREAMS, "glowfm")).toBe("Glow FM");
  });

  it("returns null for an unknown folder", () => {
    expect(displayNameForFolder(STREAMS, "nope")).toBeNull();
  });
});

describe("existingHoursFor", () => {
  it("returns the hours present for a known day, sorted ascending", () => {
    expect(existingHoursFor(TREE, "Glow FM", "2026", "10", "23")).toEqual([
      "09",
      "14",
      "15",
    ]);
  });

  it("returns [] for an unknown stream", () => {
    expect(existingHoursFor(TREE, "Unknown", "2026", "10", "23")).toEqual([]);
  });

  it("returns [] for a day with no recordings", () => {
    expect(existingHoursFor(TREE, "Glow FM", "2026", "10", "24")).toEqual([]);
    expect(existingHoursFor(TREE, "Glow FM", "2025", "10", "23")).toEqual([]);
  });
});
