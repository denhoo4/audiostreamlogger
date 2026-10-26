import { describe, expect, it } from "vitest";
import {
  audioJsonUrl,
  audioUrl,
  currentAmsterdamSlot,
  isLiveHour,
  liveHourElapsedSeconds,
} from "./api";

describe("currentAmsterdamSlot", () => {
  it("zero-pads and reflects the Amsterdam wall clock (CEST +2) for a fixed instant", () => {
    // 2026-07-15T08:30:00Z — summer, so Amsterdam is CEST (+2): 10:30 local.
    const slot = currentAmsterdamSlot(new Date("2026-07-15T08:30:00Z"));
    expect(slot).toEqual({
      year: "2026",
      month: "07",
      day: "15",
      hour: "10",
    });
  });

  it("reflects the Amsterdam wall clock (CET +1) for a winter instant", () => {
    // 2026-01-15T08:30:00Z — winter, so Amsterdam is CET (+1): 09:30 local.
    const slot = currentAmsterdamSlot(new Date("2026-01-15T08:30:00Z"));
    expect(slot).toEqual({
      year: "2026",
      month: "01",
      day: "15",
      hour: "09",
    });
  });

  it("uses h23 so midnight is '00' and rolls the date forward in Amsterdam", () => {
    // 2026-07-15T22:30:00Z -> 00:30 local on the 16th (CEST +2).
    const slot = currentAmsterdamSlot(new Date("2026-07-15T22:30:00Z"));
    expect(slot).toEqual({
      year: "2026",
      month: "07",
      day: "16",
      hour: "00",
    });
  });
});

describe("isLiveHour", () => {
  const slot = { year: "2026", month: "10", day: "23", hour: "14" };

  it("returns true only on an exact four-field match", () => {
    expect(
      isLiveHour(slot, {
        year: "2026",
        month: "10",
        day: "23",
        hour: "14",
      }),
    ).toBe(true);
  });

  it("returns false when any single field differs", () => {
    expect(
      isLiveHour(slot, {
        year: "2026",
        month: "10",
        day: "23",
        hour: "13",
      }),
    ).toBe(false);
    expect(
      isLiveHour(slot, {
        year: "2026",
        month: "10",
        day: "22",
        hour: "14",
      }),
    ).toBe(false);
    expect(
      isLiveHour(slot, {
        year: "2026",
        month: "09",
        day: "23",
        hour: "14",
      }),
    ).toBe(false);
    expect(
      isLiveHour(slot, {
        year: "2025",
        month: "10",
        day: "23",
        hour: "14",
      }),
    ).toBe(false);
  });
});

describe("liveHourElapsedSeconds", () => {
  it("is ~0 at the top of the Amsterdam hour", () => {
    // 2026-07-15T08:00:00Z -> Amsterdam CEST 10:00:00 (top of the hour).
    expect(liveHourElapsedSeconds(new Date("2026-07-15T08:00:00Z"))).toBe(0);
  });

  it("is ~1200 twenty minutes into the Amsterdam hour", () => {
    // 2026-07-15T08:20:00Z -> Amsterdam CEST 10:20:00 -> 20 min = 1200 s.
    expect(liveHourElapsedSeconds(new Date("2026-07-15T08:20:00Z"))).toBe(1200);
  });

  it("counts the seconds within the minute too", () => {
    // 10:20:35 local -> 20*60 + 35 = 1235 s.
    expect(liveHourElapsedSeconds(new Date("2026-07-15T08:20:35Z"))).toBe(1235);
  });

  it("clamps to at most one full hour (3600)", () => {
    // 10:59:59 local -> 59*60 + 59 = 3599 (just under the cap).
    expect(liveHourElapsedSeconds(new Date("2026-07-15T08:59:59Z"))).toBe(3599);
  });

  it("is DST-correct via the Amsterdam formatter (winter CET)", () => {
    // 2026-01-15T08:45:00Z -> Amsterdam CET 09:45:00 -> 45 min = 2700 s.
    expect(liveHourElapsedSeconds(new Date("2026-01-15T08:45:00Z"))).toBe(2700);
  });
});

describe("audioUrl / audioJsonUrl cacheBust", () => {
  it("appends ?t= only when cacheBust is given", () => {
    const plain = audioUrl("radio", "2026", "10", "23", "14", "mp3");
    expect(plain).toBe(
      `${window.location.origin}/audio/radio/radio-2026-10-23-14.mp3`,
    );
    const busted = audioUrl("radio", "2026", "10", "23", "14", "mp3", 12345);
    expect(busted).toBe(
      `${window.location.origin}/audio/radio/radio-2026-10-23-14.mp3?t=12345`,
    );

    const plainJson = audioJsonUrl("radio", "2026", "10", "23", "14");
    expect(plainJson).toBe(
      `${window.location.origin}/audio/radio/radio-2026-10-23-14.json`,
    );
    const bustedJson = audioJsonUrl(
      "radio",
      "2026",
      "10",
      "23",
      "14",
      67890,
    );
    expect(bustedJson).toBe(
      `${window.location.origin}/audio/radio/radio-2026-10-23-14.json?t=67890`,
    );
  });
});
