import { describe, expect, it } from "vitest";
import {
  displayNameForFolder,
  existingDaysFor,
  existingHoursFor,
} from "./player-hours";
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

// A tree spanning multiple years/months/days, including a day whose hour list is
// empty (must NOT be reported as an existing day) and a stream with no logs.
const DAYS_TREE: Settings2 = {
  "Glow FM": {
    "2026": {
      "10": {
        "23": ["09", "14"],
        "24": ["00"],
      },
      "11": {
        "01": ["23"],
      },
    },
    "2025": {
      "12": {
        "31": ["12"],
      },
    },
  } as unknown as Settings2[string],
  // A stream present in the tree but with an empty-hours day -> no existing day.
  Sublime: {
    "2026": {
      "10": {
        "23": [],
      },
    },
  } as unknown as Settings2[string],
};

describe("existingDaysFor", () => {
  it("returns the full set of YYYY-MM-DD days with recordings for a stream", () => {
    const days = existingDaysFor(DAYS_TREE, "Glow FM");
    expect(days).toEqual(
      new Set(["2026-10-23", "2026-10-24", "2026-11-01", "2025-12-31"]),
    );
  });

  it("returns an empty set for a stream with no recordings in the tree", () => {
    expect(existingDaysFor(DAYS_TREE, "Unknown")).toEqual(new Set());
  });

  it("skips days whose hour list is empty", () => {
    // "Sublime" only has 2026-10-23 with an empty hours array -> no days.
    expect(existingDaysFor(DAYS_TREE, "Sublime")).toEqual(new Set());
  });
});
