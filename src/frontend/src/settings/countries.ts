// ISO 3166-1 helpers for the settings admin UI, sourced from the bundled
// frontend copy of iso-3166-1.json (identical content to the api copy — the two
// copies are kept in sync, see design §2.11). Used to build the country <select>
// options and the code->name display map for the stream table.
import isoData from "../data/iso-3166-1.json";

export interface Country {
  code: string;
  name: string;
}

/** All ISO 3166-1 countries (alpha-2 code + English short name). */
export const COUNTRIES: Country[] = isoData as Country[];

/** Countries sorted by name, for rendering the dropdown options. */
export const COUNTRIES_BY_NAME: Country[] = [...COUNTRIES].sort((a, b) =>
  a.name.localeCompare(b.name),
);

/** alpha-2 code -> full country name lookup for the table read view. */
const CODE_TO_NAME = new Map<string, string>(
  COUNTRIES.map((c) => [c.code, c.name]),
);

/**
 * Map a stored alpha-2 code to its full country name. Falls back to the raw
 * code if it is not in the list (defensive; write validation should prevent it).
 */
export function countryName(code: string): string {
  return CODE_TO_NAME.get(code) ?? code;
}
