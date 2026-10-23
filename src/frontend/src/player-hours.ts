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
