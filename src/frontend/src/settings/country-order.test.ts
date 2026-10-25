import { describe, expect, it } from "vitest";
import { orderCountries, sortStreamsByCountryOrder } from "./country-order";

// countryName() maps: NL -> Netherlands, BE -> Belgium, DE -> Germany,
// FR -> France, GB -> United Kingdom (per the bundled ISO 3166-1 list). The
// alphabetical-by-NAME fallback therefore orders unlisted codes as:
// Belgium < France < Germany < Netherlands < United Kingdom.

describe("orderCountries", () => {
  it("places listed countries first in the given order", () => {
    expect(orderCountries(["NL", "BE"], ["BE", "NL"])).toEqual(["NL", "BE"]);
  });

  it("places unlisted countries AFTER, alphabetical by NAME", () => {
    // Only NL is listed; DE/BE/FR fall after, alphabetical by name.
    expect(orderCountries(["NL"], ["DE", "FR", "BE", "NL"])).toEqual([
      "NL",
      "BE",
      "FR",
      "DE",
    ]);
  });

  it("empty codes -> pure alphabetical-by-name order", () => {
    expect(orderCountries([], ["NL", "DE", "BE"])).toEqual(["BE", "DE", "NL"]);
  });

  it("ignores listed codes that are not present and de-duplicates present", () => {
    expect(orderCountries(["GB", "NL"], ["NL", "NL", "BE"])).toEqual([
      "NL",
      "BE",
    ]);
  });
});

describe("sortStreamsByCountryOrder", () => {
  const streams = [
    { country: "DE", name: "DE-1" },
    { country: "NL", name: "NL-1" },
    { country: "BE", name: "BE-1" },
    { country: "NL", name: "NL-2" },
    { country: "DE", name: "DE-2" },
  ];

  it("re-groups countries by the given order", () => {
    const out = sortStreamsByCountryOrder(streams, ["NL", "BE"]);
    expect(out.map((s) => s.name)).toEqual([
      "NL-1",
      "NL-2",
      "BE-1",
      "DE-1",
      "DE-2",
    ]);
  });

  it("preserves each stream's relative order within its country", () => {
    const out = sortStreamsByCountryOrder(streams, ["DE"]);
    const de = out.filter((s) => s.country === "DE").map((s) => s.name);
    expect(de).toEqual(["DE-1", "DE-2"]);
    const nl = out.filter((s) => s.country === "NL").map((s) => s.name);
    expect(nl).toEqual(["NL-1", "NL-2"]);
  });

  it("empty codes -> pure alphabetical-by-name grouping (within-order kept)", () => {
    const out = sortStreamsByCountryOrder(streams, []);
    // Belgium < Germany < Netherlands by name.
    expect(out.map((s) => s.name)).toEqual([
      "BE-1",
      "DE-1",
      "DE-2",
      "NL-1",
      "NL-2",
    ]);
  });

  it("does not mutate the input array", () => {
    const copy = [...streams];
    sortStreamsByCountryOrder(streams, ["NL"]);
    expect(streams).toEqual(copy);
  });
});
