// Pure helper that derives an on-disk folder name from a stream's display name,
// for NEW streams only. The api validator (src/api/lib/validate-stream.js)
// requires the folder to match ^[a-z0-9_-]+$ on both create and update, so the
// derived value is always lowercased, whitespace-collapsed to '_', stripped of
// any char outside [a-z0-9_-], de-duplicated on repeated separators, trimmed of
// leading/trailing separators, and never empty (falls back to "stream"). When
// the candidate collides with an existing folder, the smallest free numeric
// suffix (_2, _3, …) is appended and `collided` is reported so the UI can show
// a notice.
//
// This is used ONLY when creating a stream. Existing streams keep their STORED
// folder verbatim on update — the folder is never re-derived from an edited
// name, so existing recordings never move.

/**
 * Normalize a display name to an allowlist-valid folder base (no collision
 * handling). lowercased; whitespace runs -> single '_'; any char not in
 * [a-z0-9_-] stripped; repeated '_'/'-' collapsed to one; leading/trailing
 * separators trimmed; empty result falls back to "stream".
 */
function normalizeFolder(name: string): string {
  const base = name
    .toLowerCase()
    // Whitespace runs become a single underscore.
    .replace(/\s+/g, "_")
    // Drop anything outside the allowlist (keeps a-z, 0-9, _, -).
    .replace(/[^a-z0-9_-]+/g, "")
    // Collapse any run of separators (mix of _ and -) to a single '_'.
    .replace(/[_-]{2,}/g, "_")
    // Trim leading/trailing separators.
    .replace(/^[_-]+/, "")
    .replace(/[_-]+$/, "");
  return base === "" ? "stream" : base;
}

/**
 * Derive an allowlist-valid on-disk folder from a stream name for NEW streams
 * only. Returns { folder, collided } so the UI can surface a notice when the
 * base collided with an existing folder and a numeric suffix was appended.
 *
 * Examples: '100% NL' -> '100_nl'; 'NPO 3FM' -> 'npo_3fm';
 * deriveFolder('Radio One', ['radio_one']) -> 'radio_one_2' (collided).
 */
export function deriveFolder(
  name: string,
  existing: Iterable<string>,
): { folder: string; collided: boolean } {
  const base = normalizeFolder(name);
  const taken = new Set(existing);
  if (!taken.has(base)) {
    return { folder: base, collided: false };
  }
  // Base is taken: append the smallest free numeric suffix (_2, _3, …).
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) {
      return { folder: candidate, collided: true };
    }
  }
}
