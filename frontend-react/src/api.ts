// Typed client for the existing Express backend (frontend/index.js + routes/).
// All requests target the same origin: no base URL, no extra CORS assumptions
// beyond what the backend already sets. The backend is NOT modified by this app.

/** A single stream as returned by GET /api/settings (settings.json -> streams[]). */
export interface Stream {
  country: string;
  name: string;
  folder: string;
  url: string;
}

/**
 * Nested browse tree returned by GET /api/settings2, keyed by display name
 * (underscores replaced by spaces): station -> year -> month -> day -> hours[].
 * Defined for future work; the UI does not consume it yet (it uses /api/settings,
 * matching the legacy app exactly).
 */
export type Settings2 = Record<
  string,
  {
    country?: string;
    folder?: string;
    url?: string;
    logs?: Record<
      string,
      Record<string, Record<string, string[]>>
    >;
    [key: string]: unknown;
  }
>;

/** Body for POST /util/selection-export. Times are in seconds. */
export interface SelectionExportBody {
  station_id: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  startTime: number;
  endTime: number;
}

/** GET /api/settings -> raw streams array (drives the stream selector). */
export async function getSettings(): Promise<Stream[]> {
  const res = await fetch(`${window.location.origin}/api/settings`);
  if (!res.ok) {
    throw new Error(`GET /api/settings failed: ${res.status}`);
  }
  return (await res.json()) as Stream[];
}

/**
 * GET /api/settings2 -> nested browse tree. Typed client available for later
 * work; not wired into the UI yet.
 */
export async function getSettings2(): Promise<Settings2> {
  const res = await fetch(`${window.location.origin}/api/settings2`);
  if (!res.ok) {
    throw new Error(`GET /api/settings2 failed: ${res.status}`);
  }
  return (await res.json()) as Settings2;
}

/** URL of the recorded mp3 for a given folder + date/hour. */
export function audioMp3Url(
  folder: string,
  year: string,
  month: string,
  day: string,
  hour: string,
): string {
  return `${window.location.origin}/audio/${folder}/${folder}-${year}-${month}-${day}-${hour}.mp3`;
}

/** URL of the precomputed peaks JSON for a given folder + date/hour. */
export function audioJsonUrl(
  folder: string,
  year: string,
  month: string,
  day: string,
  hour: string,
): string {
  return `${window.location.origin}/audio/${folder}/${folder}-${year}-${month}-${day}-${hour}.json`;
}

/**
 * POST /util/selection-export. Returns the trimmed mp3 as a Blob.
 * Throws on a non-ok response so the caller can hide the "wait" message.
 */
export async function exportSelection(body: SelectionExportBody): Promise<Blob> {
  const res = await fetch(`${window.location.origin}/util/selection-export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST /util/selection-export failed: ${res.status}`);
  }
  return await res.blob();
}
