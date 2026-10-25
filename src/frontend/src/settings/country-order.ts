// Framework-free country-ordering helpers shared by the admin StreamTable and
// the anonymous player. The ORDER of countries is driven by an explicit
// admin-chosen list (app_config `country_order`, FEAT-001); any country not in
// that list falls AFTER the listed ones, sorted alphabetically by its full
// country NAME (not its code). Per-stream order within a country is NEVER
// touched here — only the grouping/ordering of whole countries changes.
import { countryName } from "./countries";

/**
 * Order a set of PRESENT country codes: the codes that appear in `codes` come
 * first, in the exact order they appear in `codes`; every remaining present
 * code follows, sorted alphabetically by its country NAME (localeCompare, the
 * same collation COUNTRIES_BY_NAME uses). `codes` may contain codes that are
 * not present (ignored) and `present` may contain duplicates (de-duplicated,
 * first-appearance wins). Returns a new array of distinct codes.
 */
export function orderCountries(codes: string[], present: string[]): string[] {
  // De-duplicate the present codes, preserving first appearance.
  const distinct: string[] = [];
  const seen = new Set<string>();
  for (const code of present) {
    if (!seen.has(code)) {
      seen.add(code);
      distinct.push(code);
    }
  }
  const presentSet = new Set(distinct);

  // Listed codes first, in list order, but only those actually present.
  const listed: string[] = [];
  const listedSet = new Set<string>();
  for (const code of codes) {
    if (presentSet.has(code) && !listedSet.has(code)) {
      listed.push(code);
      listedSet.add(code);
    }
  }

  // The rest, alphabetical by country name.
  const rest = distinct
    .filter((code) => !listedSet.has(code))
    .sort((a, b) => countryName(a).localeCompare(countryName(b)));

  return [...listed, ...rest];
}

/**
 * Re-group a flat stream list so its countries follow orderCountries() while
 * preserving each stream's existing relative order WITHIN its country (stable).
 * Returns a NEW array; the input and each stream's sort_order are untouched.
 */
export function sortStreamsByCountryOrder<T extends { country: string }>(
  streams: T[],
  codes: string[],
): T[] {
  const present = streams.map((s) => s.country);
  const ordered = orderCountries(codes, present);

  // Bucket streams by country, preserving within-country order.
  const buckets = new Map<string, T[]>();
  for (const stream of streams) {
    const bucket = buckets.get(stream.country);
    if (bucket) {
      bucket.push(stream);
    } else {
      buckets.set(stream.country, [stream]);
    }
  }

  const result: T[] = [];
  for (const code of ordered) {
    const bucket = buckets.get(code);
    if (bucket) result.push(...bucket);
  }
  return result;
}
