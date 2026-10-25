// Pure helpers that derive the player's hour dropdown from the public
// GET /api/settings2 browse tree, so the selector only offers hours that
// actually have a recording for the chosen stream + day.
//
// The /settings2 tree is keyed by the stored station NAME verbatim (the
// historical underscore-to-space display workaround was removed in FEAT-001):
//   { [stationName]: { [year]: { [month]: { [day]: string[] } } } }
// A stream's tree key is therefore just its stored `name`.

import type { Settings2, Stream } from "./api";

/**
 * The settings2 tree key for a given folder: the matching stream's stored name
 * verbatim. Returns null when no stream has that folder.
 */
export function displayNameForFolder(
  streams: Stream[],
  folder: string,
): string | null {
  const match = streams.find((s) => s.folder === folder);
  return match ? match.name : null;
}

/**
 * Hours present in the tree for a station display name + year/month/day, sorted
 * ascending. Returns [] when any level (station, year, month, day) is absent or
 * the leaf is not an array.
 */
export function existingHoursFor(
  tree: Settings2,
  displayName: string,
  year: string,
  month: string,
  day: string,
): string[] {
  const station = tree?.[displayName] as
    | Record<string, Record<string, Record<string, string[]>>>
    | undefined;
  const hours = station?.[year]?.[month]?.[day];
  if (!Array.isArray(hours)) return [];
  return [...hours].sort();
}

/**
 * The set of `YYYY-MM-DD` days that actually have at least one recorded hour for
 * a station display name, derived from the GET /api/settings2 browse tree. Used
 * by the player's calendar to enable only days with recordings for the selected
 * stream (all other days are disabled). Returns an empty set when the station is
 * absent or has no recordings — the calendar then shows no selectable days.
 *
 * The cast mirrors `existingHoursFor` EXACTLY: the TS `Settings2` type wraps the
 * year/month/day levels in a `logs` key, but the runtime /settings2 transform
 * (src/api/lib/settings-transform.js) flattens that away, so the station node is
 * read as a plain year -> month -> day -> hours[] record. Using the identical
 * cast keeps `tsc -b` happy against the runtime shape.
 */
export function existingDaysFor(
  tree: Settings2,
  displayName: string,
): Set<string> {
  const days = new Set<string>();
  const station = tree?.[displayName] as
    | Record<string, Record<string, Record<string, string[]>>>
    | undefined;
  if (!station) return days;
  for (const year of Object.keys(station)) {
    const months = station[year];
    if (!months || typeof months !== "object") continue;
    for (const month of Object.keys(months)) {
      const daysOfMonth = months[month];
      if (!daysOfMonth || typeof daysOfMonth !== "object") continue;
      for (const day of Object.keys(daysOfMonth)) {
        const hours = daysOfMonth[day];
        // Guard: only count a day that actually has recorded hours.
        if (Array.isArray(hours) && hours.length > 0) {
          days.add(`${year}-${month}-${day}`);
        }
      }
    }
  }
  return days;
}
