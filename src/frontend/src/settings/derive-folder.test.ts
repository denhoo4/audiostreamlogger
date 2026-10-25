import { describe, expect, it } from "vitest";
import { deriveFolder } from "./derive-folder";

/**
 * Pure unit tests for deriveFolder (NEW-stream folder derivation). The exact
 * expected strings are pinned so the normalization + collision strategy can't
 * drift. Every result must match the api allowlist ^[a-z0-9_-]+$ and be
 * non-empty.
 */
const ALLOWLIST = /^[a-z0-9_-]+$/;

describe("deriveFolder", () => {
  it("normalizes '100% NL' to '100_nl'", () => {
    expect(deriveFolder("100% NL", [])).toEqual({
      folder: "100_nl",
      collided: false,
    });
  });

  it("normalizes 'NPO 3FM' to 'npo_3fm'", () => {
    expect(deriveFolder("NPO 3FM", [])).toEqual({
      folder: "npo_3fm",
      collided: false,
    });
  });

  it("leaves an already-clean name unchanged", () => {
    expect(deriveFolder("radio_one", [])).toEqual({
      folder: "radio_one",
      collided: false,
    });
  });

  it("collapses repeated separators to a single underscore", () => {
    expect(deriveFolder("A  --  B", [])).toEqual({
      folder: "a_b",
      collided: false,
    });
  });

  it("trims leading/trailing separators", () => {
    expect(deriveFolder("  Jazz! ", [])).toEqual({
      folder: "jazz",
      collided: false,
    });
  });

  it("falls back to 'stream' for an all-stripped name", () => {
    expect(deriveFolder("%%%", [])).toEqual({
      folder: "stream",
      collided: false,
    });
  });

  it("falls back to 'stream' for an empty name", () => {
    expect(deriveFolder("", [])).toEqual({
      folder: "stream",
      collided: false,
    });
  });

  it("strips non-ASCII letters (accents are not transliterated)", () => {
    // Documented behaviour: accented/non-ASCII letters are dropped, not mapped.
    // 'Café' -> 'caf' (the é is stripped).
    expect(deriveFolder("Café", [])).toEqual({
      folder: "caf",
      collided: false,
    });
  });

  it("appends '_2' and reports collided on a base collision", () => {
    expect(deriveFolder("Radio One", ["radio_one"])).toEqual({
      folder: "radio_one_2",
      collided: true,
    });
  });

  it("chains the suffix past a taken '_2'", () => {
    expect(
      deriveFolder("Radio One", ["radio_one", "radio_one_2"]),
    ).toEqual({
      folder: "radio_one_3",
      collided: true,
    });
  });

  it("reports collided:false when there is no collision", () => {
    expect(deriveFolder("Radio Three", ["radio_one"]).collided).toBe(false);
  });

  it("always yields an allowlist-valid, non-empty folder", () => {
    const names = ["100% NL", "NPO 3FM", "%%%", "", "  Jazz! ", "Café", "A--B"];
    for (const name of names) {
      const { folder } = deriveFolder(name, []);
      expect(folder.length).toBeGreaterThan(0);
      expect(folder).toMatch(ALLOWLIST);
    }
    // Suffixed results are allowlist-valid too.
    const { folder } = deriveFolder("Radio One", ["radio_one"]);
    expect(folder).toMatch(ALLOWLIST);
  });
});
