// Typed client for the existing Express backend (frontend/index.js + routes/).
// All requests target the same origin: no base URL, no extra CORS assumptions
// beyond what the backend already sets. The backend is NOT modified by this app.

/** Audio codec of a stream's recordings; the on-disk file extension equals the codec. */
export type Codec = "mp3" | "opus" | "flac";

/** A single stream as returned by GET /api/settings (public player selector). */
export interface Stream {
  country: string;
  name: string;
  folder: string;
  url: string;
  codec: Codec;
}

/**
 * A stream row as returned by the authenticated admin endpoints
 * (GET/POST/PUT /api/streams): the four public fields plus the DB id and
 * timestamps. Kept distinct from the public Stream so the player code (which
 * only ever sees Stream) stays untouched.
 */
export interface StreamRecord {
  id: number;
  country: string;
  name: string;
  folder: string;
  url: string;
  codec: Codec;
  bitrate_kbps: number | null;
  bit_depth: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Writable stream fields for create/update (no id/timestamps). */
export type StreamInput = Pick<
  StreamRecord,
  "country" | "name" | "folder" | "url" | "codec" | "bitrate_kbps" | "bit_depth"
>;

/** Shape of GET /auth/me. */
export interface AuthState {
  authenticated: boolean;
  username?: string;
}

/** A job row as returned by GET /api/jobs and the SSE stream (requireAuth). */
export interface JobRecord {
  id: number;
  type: "cleaner" | "peakfilegenerator" | "reconcile";
  trigger_source: "manual" | "schedule";
  status: "pending" | "running" | "done" | "failed" | "skipped";
  output: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** A schedule row as returned by GET /api/schedules (requireAuth). */
export interface ScheduleRecord {
  type: "cleaner" | "peakfilegenerator" | "reconcile";
  enabled: 0 | 1;
  frequency: "hourly" | "daily" | "weekly";
  minute: number;
  hour: number;
  day_of_week: number;
  last_run_at: string | null;
}

/** Writable schedule fields for PUT /api/schedules/:type. */
export type ScheduleInput = Pick<
  ScheduleRecord,
  "enabled" | "frequency" | "minute" | "hour" | "day_of_week"
>;

/**
 * Per-stream recording roll-up as returned inside GET /api/analysis/summary
 * (requireAuth). One entry per stream_folder; total_hours == recording_count
 * (one row per hour-slot). earliest/latest are 'YYYY-MM-DD-HH' slot keys, or
 * null when the stream has no rows; avg_duration_seconds is null when no
 * durations are known. See FEAT-001 services/recordings.js::summarize.
 */
export interface AnalysisStreamSummary {
  stream_folder: string;
  total_hours: number;
  storage_bytes: number;
  recording_count: number;
  avg_duration_seconds: number | null;
  earliest: string | null;
  latest: string | null;
}

/**
 * Overall roll-up across every stream, returned alongside per_stream in
 * GET /api/analysis/summary. Same aggregate fields as a per-stream row plus a
 * distinct stream_count.
 */
export interface AnalysisOverall {
  total_hours: number;
  storage_bytes: number;
  recording_count: number;
  avg_duration_seconds: number | null;
  earliest: string | null;
  latest: string | null;
  stream_count: number;
}

/** Shape of GET /api/analysis/summary (requireAuth). */
export interface AnalysisSummary {
  per_stream: AnalysisStreamSummary[];
  overall: AnalysisOverall;
}

/**
 * Shape of GET /api/analysis/gaps?folder=&start=&end= (requireAuth): hourly
 * coverage for one folder over an inclusive date range. `missing` lists the
 * expected hour slots with no recorded row; coverage_ratio is
 * present_count/expected_count (0 when expected_count is 0).
 */
export interface AnalysisGaps {
  folder: string;
  start: string;
  end: string;
  expected_count: number;
  present_count: number;
  missing: { date: string; hour: string }[];
  coverage_ratio: number;
}

/**
 * One stream's TWO-SIGNAL health as returned inside
 * GET /api/analysis/stream-health (requireAuth):
 *   - `recordingNow`: is this stream recording the CURRENT Amsterdam-local
 *     hour-slot (the green check). Decided ONLY from the current slot; the 24h
 *     gap history does NOT affect it.
 *   - `last24h`: a purely informational gap summary over the past 24h. `complete`
 *     when there are no gaps; `gaps` lists the missing Amsterdam-local
 *     {date, hour} slots (the in-progress current hour is excluded).
 *   - `lastSlotStatus`: the current slot's row status (or null) — a small hint.
 * See services/stream-health.js::deriveStreamHealth.
 */
export interface StreamHealthEntry {
  folder: string;
  name: string;
  recordingNow: boolean;
  last24h: {
    complete: boolean;
    gapCount: number;
    gaps: { date: string; hour: string }[];
  };
  lastSlotStatus: string | null;
}

/** Roll-up counts across all streams in a stream-health response. */
export interface StreamHealthCounts {
  total: number;
  recordingNow: number;
  notRecording: number;
}

/**
 * Shape of GET /api/analysis/stream-health?windowHours=N (requireAuth):
 * per-stream two-signal health (recording-now check + last-24h gap summary)
 * plus a roll-up of how many streams are recording right now. `generated_slot`
 * is the current Amsterdam-local hour-slot the window ends at; `window_hours`
 * is the window length (default 24).
 */
export interface StreamHealthResponse {
  window_hours: number;
  generated_slot: { date: string; hour: string };
  counts: StreamHealthCounts;
  streams: StreamHealthEntry[];
}

/**
 * One stream's projected storage line inside GET /api/analysis/storage-estimate
 * (requireAuth): `bytesPerHour` is the MEASURED mean of complete recordings
 * (`source: "measured"`) or a THEORETICAL estimate from the quality fields
 * (`source: "estimated"`); `projectedBytes` is bytesPerHour × the retention
 * window.
 */
export interface StorageEstimatePerStream {
  folder: string;
  name: string;
  bytesPerHour: number;
  source: "measured" | "estimated";
  projectedBytes: number;
}

/** The projection object returned inside a storage-estimate response. */
export interface StorageEstimateProjection {
  perStream: StorageEstimatePerStream[];
  totalProjectedBytes: number;
  retentionHours: number;
}

/**
 * Shape of GET /api/analysis/storage-estimate (requireAuth): a read-only
 * projection of steady-state disk usage (per stream + total) over the configured
 * retention window, plus `actual_bytes` currently on disk.
 */
export interface StorageEstimateResponse {
  retention_hours: number;
  projection: StorageEstimateProjection;
  actual_bytes: number;
}

/**
 * An api error carrying the backend's {error, field?} body so forms can show
 * the server-side validation message (400) or conflict message (409).
 */
export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

/**
 * Parse a non-ok response into an ApiError, preferring the backend's
 * {error, field} JSON body and falling back to the status text.
 */
async function toApiError(res: Response): Promise<ApiError> {
  let message = `request failed: ${res.status}`;
  let field: string | undefined;
  try {
    const body = (await res.json()) as { error?: string; field?: string };
    if (body && typeof body.error === "string") message = body.error;
    if (body && typeof body.field === "string") field = body.field;
  } catch {
    // Non-JSON body; keep the status-based message.
  }
  return new ApiError(message, res.status, field);
}

/**
 * Nested browse tree returned by GET /api/settings2, keyed by the stored
 * station name verbatim: station -> year -> month -> day -> hours[].
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
  /** Source/output extension (== the stream's codec); defaults to 'mp3' server-side. */
  ext?: Codec;
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

/** Zero-padded Amsterdam-local hour-slot fields used for live-hour detection. */
export interface AmsterdamSlot {
  year: string;
  month: string;
  day: string;
  hour: string;
}

// Amsterdam-local formatter mirroring src/api/lib/amsterdam-slot.js (TODO item
// 21): timeZone 'Europe/Amsterdam' + hourCycle 'h23' so the slot is DST-correct
// (CEST +2 / CET +1) and never depends on the browser's ambient TZ. en-GB is
// used so formatToParts yields numeric fields; punctuation is irrelevant since
// we read parts by type, not a formatted string.
const AMS_SLOT_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * The current Amsterdam-local hour-slot as zero-padded strings
 * { year, month, day, hour }. DST-safe via Intl (never a hardcoded offset);
 * `hourCycle:'h23'` makes midnight '00'. Pure: the caller injects the instant,
 * defaulting to now.
 */
export function currentAmsterdamSlot(now: Date = new Date()): AmsterdamSlot {
  const parts = AMS_SLOT_FORMATTER.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  let hour = get("hour");
  // Some ICU builds emit '24' for midnight under h23; normalize to '00'.
  if (hour === "24") hour = "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
  };
}

/**
 * True when the loaded selection's slot exactly matches the current Amsterdam
 * slot on all four fields (year, month, day, hour) — i.e. the selection IS the
 * live, still-growing recording hour.
 */
export function isLiveHour(
  slot: AmsterdamSlot,
  loaded: { year: string; month: string; day: string; hour: string },
): boolean {
  return (
    slot.year === loaded.year &&
    slot.month === loaded.month &&
    slot.day === loaded.day &&
    slot.hour === loaded.hour
  );
}

/**
 * URL of the recorded audio for a given folder + date/hour. The file extension
 * equals the stream's codec (mp3/opus/flac); opus files use an Ogg container
 * but keep the .opus on-disk extension. When `cacheBust` is provided a
 * `?t=<cacheBust>` query param is appended so a grown current-hour file is not
 * served stale from the browser/nginx cache; omitting it yields the exact
 * byte-identical URL existing callers rely on.
 */
export function audioUrl(
  folder: string,
  year: string,
  month: string,
  day: string,
  hour: string,
  ext: string,
  cacheBust?: number,
): string {
  const base = `${window.location.origin}/audio/${folder}/${folder}-${year}-${month}-${day}-${hour}.${ext}`;
  return cacheBust === undefined ? base : `${base}?t=${cacheBust}`;
}

/**
 * URL of the precomputed peaks JSON for a given folder + date/hour. Only PAST
 * hours have a stable peaks file; the current Amsterdam hour is decoded
 * client-side from the growing mp3 instead. When `cacheBust` is provided a
 * `?t=<cacheBust>` query param is appended; omitting it yields the
 * byte-identical URL existing callers rely on.
 */
export function audioJsonUrl(
  folder: string,
  year: string,
  month: string,
  day: string,
  hour: string,
  cacheBust?: number,
): string {
  const base = `${window.location.origin}/audio/${folder}/${folder}-${year}-${month}-${day}-${hour}.json`;
  return cacheBust === undefined ? base : `${base}?t=${cacheBust}`;
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

// --- Branding client (/api/app-config + /api/branding) -------------------

/**
 * GET /api/app-config/public -> runtime branding read by the public player
 * (page title). No credentials: this endpoint is unauthenticated.
 */
export async function getPublicConfig(): Promise<{
  title: string;
  default_stream_folder: string;
  country_order: string[];
}> {
  const res = await fetch(
    `${window.location.origin}/api/app-config/public`,
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  const body = (await res.json()) as {
    title: string;
    default_stream_folder: string;
    country_order?: string[];
  };
  return {
    title: body.title,
    default_stream_folder: body.default_stream_folder,
    // Default to [] for resilience if an older server omits the field.
    country_order: Array.isArray(body.country_order) ? body.country_order : [],
  };
}

/**
 * PUT /api/app-config/default-stream {folder} -> set (or clear) the default
 * stream folder preselected by the public player. A non-empty folder must match
 * an existing stream else the backend returns 400 {field:'folder'}; an empty
 * string clears the default. Returns the stored default_stream_folder.
 */
export async function setDefaultStream(
  folder: string,
): Promise<{ default_stream_folder: string }> {
  const res = await fetch(
    `${window.location.origin}/api/app-config/default-stream`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { default_stream_folder: string };
}

/**
 * PUT /api/app-config/country-order {codes} -> set the explicit admin ordering
 * of countries. `codes` is an array of ISO alpha-2 code strings; the backend
 * uppercases + stores them and returns the normalised country_order. Throws
 * ApiError on the 400 {field:'country_order'} responses (non-array/bad code).
 */
export async function setCountryOrder(
  codes: string[],
): Promise<{ country_order: string[] }> {
  const res = await fetch(
    `${window.location.origin}/api/app-config/country-order`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes }),
    },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { country_order: string[] };
}

/** PUT /api/app-config/title {title} -> update the editable page title. */
export async function putTitle(title: string): Promise<{ title: string }> {
  const res = await fetch(`${window.location.origin}/api/app-config/title`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { title: string };
}

/**
 * POST /api/branding/favicon -> upload a favicon. The File is sent as the raw
 * body with Content-Type = file.type so the backend's route-local raw parser
 * handles it (the global JSON parser does not intercept it).
 */
export async function uploadFavicon(
  file: File,
): Promise<{ ok: boolean; mime: string }> {
  const res = await fetch(`${window.location.origin}/api/branding/favicon`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { ok: boolean; mime: string };
}

/** Stable URL of the dynamic favicon serve route (used by <link> and preview). */
export function faviconUrl(): string {
  return `${window.location.origin}/api/branding/favicon`;
}

// --- Backup/export + import client (/api/backup) -------------------------
// All behind requireAuth; the same-origin session cookie travels with each
// request. Downloads come back as Blobs so the fetch carries the cookie (a bare
// <a href> would too, but the Blob approach matches App.tsx's export pattern and
// lets us surface ApiError on a 401/500).

/** Result summary returned by POST /api/backup/import. */
export interface ImportResult {
  imported: number;
  updated: number;
  skipped: { folder: string | null; reason: string }[];
  config_applied: string[];
  config_skipped?: { key: string; reason: string }[];
}

/** GET /api/backup/export -> the JSON backup as a Blob (requireAuth). */
export async function exportBackup(): Promise<Blob> {
  const res = await fetch(`${window.location.origin}/api/backup/export`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return await res.blob();
}

/** GET /api/backup/db -> the raw SQLite file as a Blob (requireAuth). */
export async function downloadDb(): Promise<Blob> {
  const res = await fetch(`${window.location.origin}/api/backup/db`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return await res.blob();
}

/** POST /api/backup/import -> upsert streams + apply safe config (requireAuth). */
export async function importBackup(json: unknown): Promise<ImportResult> {
  const res = await fetch(`${window.location.origin}/api/backup/import`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as ImportResult;
}

// --- Authenticated admin client (/auth + /api/streams) -------------------
// All of these send credentials so the httpOnly session cookie travels with
// the same-origin request; writes and the admin list are gated by requireAuth
// on the backend.

/** GET /auth/me -> current auth state (never throws on an anonymous session). */
export async function getAuthMe(): Promise<AuthState> {
  const res = await fetch(`${window.location.origin}/auth/me`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as AuthState;
}

/** POST /auth/login -> opens a session on success; throws ApiError on 400/401. */
export async function postLogin(
  username: string,
  password: string,
): Promise<AuthState> {
  const res = await fetch(`${window.location.origin}/auth/login`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as AuthState;
}

/** POST /auth/logout -> clears the session (idempotent). */
export async function postLogout(): Promise<void> {
  const res = await fetch(`${window.location.origin}/auth/logout`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
}

/** POST /auth/change-password -> updates the current user's password. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${window.location.origin}/auth/change-password`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
}

/** GET /api/streams -> admin list with id + timestamps (requireAuth). */
export async function getStreams(): Promise<StreamRecord[]> {
  const res = await fetch(`${window.location.origin}/api/streams`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as StreamRecord[];
}

/** POST /api/streams -> create a stream; returns the created row. */
export async function createStream(
  body: StreamInput,
): Promise<StreamRecord> {
  const res = await fetch(`${window.location.origin}/api/streams`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as StreamRecord;
}

/** PUT /api/streams/:id -> update a stream; returns the updated row. */
export async function updateStream(
  id: number,
  body: StreamInput,
): Promise<StreamRecord> {
  const res = await fetch(`${window.location.origin}/api/streams/${id}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as StreamRecord;
}

/**
 * PUT /api/streams/reorder {order} -> persist a new global stream ordering.
 * `order` must list every current stream id exactly once (positive integers);
 * the backend assigns sort_order = array index. Throws ApiError on the 400
 * {field:'order'} responses (non-array/invalid or an id-set mismatch).
 */
export async function reorderStreams(
  order: number[],
): Promise<{ ok: true }> {
  const res = await fetch(`${window.location.origin}/api/streams/reorder`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { ok: true };
}

/**
 * ADVISORY deletion-impact snapshot for a stream (TODO item 25): the file count
 * + total bytes under its on-disk audio/<folder>/. Advisory ONLY — the real
 * gate is the typed-folder confirmation in the UI. Shape matches
 * src/api/services/stream-lifecycle.js::deletionImpact.
 */
export interface DeletionImpact {
  folder: string;
  fileCount: number;
  totalBytes: number;
}

/** GET /api/streams/:id/deletion-impact -> advisory file/byte snapshot. */
export async function getDeletionImpact(id: number): Promise<DeletionImpact> {
  const res = await fetch(
    `${window.location.origin}/api/streams/${id}/deletion-impact`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as DeletionImpact;
}

/**
 * DELETE /api/streams/:id -> remove a stream, its recordings rows AND its
 * on-disk folder (TODO item 25, destructive + irreversible). The backend
 * returns 409 when the stream is recording the current hour-slot right now;
 * that surfaces as an ApiError the caller shows inline.
 */
export async function deleteStream(id: number): Promise<void> {
  const res = await fetch(`${window.location.origin}/api/streams/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
}

/**
 * Result of the advisory reachability probe (POST /api/streams/test-url).
 * `reachable` is the headline; `detail` is a short human reason shown inline.
 * `status`/`contentType` are present when the probe got a response.
 */
export interface StreamTestResult {
  reachable: boolean;
  status?: number;
  contentType?: string;
  detail: string;
}

/**
 * POST /api/streams/test-url {url} -> advisory reachability probe (requireAuth).
 * NON-BLOCKING "Test" helper: it never persists anything. A reachable/
 * not-reachable outcome comes back as a 200 StreamTestResult; a malformed /
 * non-http(s) url surfaces the backend's 400 {error, field:'url'} as an
 * ApiError (same pattern as createStream/putTitle).
 */
export async function testStreamUrl(url: string): Promise<StreamTestResult> {
  const res = await fetch(`${window.location.origin}/api/streams/test-url`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as StreamTestResult;
}

// --- Job-queue admin client (/api/jobs + /api/schedules + /api/config) ----
// All behind requireAuth; same-origin credentials carry the session cookie.

/**
 * GET /api/worker/status -> worker liveness for the admin screen (requireAuth).
 * `current_job` is the full jobs row the worker is executing, or null when idle
 * / the job id is unknown. Missing status keys come back as null (never 500).
 */
export async function getWorkerStatus(): Promise<{
  last_heartbeat: string | null;
  status: string | null;
  current_job: JobRecord | null;
}> {
  const res = await fetch(`${window.location.origin}/api/worker/status`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as {
    last_heartbeat: string | null;
    status: string | null;
    current_job: JobRecord | null;
  };
}

/** GET /api/jobs?limit= -> recent jobs, newest first (requireAuth). */
export async function listJobs(limit = 50): Promise<JobRecord[]> {
  const res = await fetch(
    `${window.location.origin}/api/jobs?limit=${limit}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as JobRecord[];
}

/** POST /api/jobs -> "Run now"; enqueues a manual job and returns the row. */
export async function runJobNow(
  type: JobRecord["type"],
): Promise<JobRecord> {
  const res = await fetch(`${window.location.origin}/api/jobs`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as JobRecord;
}

/** GET /api/jobs/schedules -> all schedule rows (requireAuth). */
export async function listSchedules(): Promise<ScheduleRecord[]> {
  const res = await fetch(`${window.location.origin}/api/jobs/schedules`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as ScheduleRecord[];
}

/** PUT /api/jobs/schedules/:type -> update a schedule; returns the row. */
export async function updateSchedule(
  type: ScheduleRecord["type"],
  body: ScheduleInput,
): Promise<ScheduleRecord> {
  const res = await fetch(
    `${window.location.origin}/api/jobs/schedules/${type}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as ScheduleRecord;
}

/** GET /api/jobs/config/log_retention -> current retention in hours. */
export async function getLogRetention(): Promise<{ hours: number | null }> {
  const res = await fetch(
    `${window.location.origin}/api/jobs/config/log_retention`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { hours: number | null };
}

/** PUT /api/jobs/config/log_retention {hours} -> set retention in hours. */
export async function setLogRetention(
  hours: number,
): Promise<{ hours: number }> {
  const res = await fetch(
    `${window.location.origin}/api/jobs/config/log_retention`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { hours: number };
}

/**
 * Open the live job SSE stream (GET /api/jobs/stream). The stream is
 * same-origin, so the httpOnly session cookie is sent automatically and
 * requireAuth authenticates it; withCredentials is set as harmless
 * belt-and-suspenders only (a no-op same-origin). `onSnapshot` fires once on
 * connect with the recent-jobs list; `onJob` fires for each changed row.
 * Returns the EventSource so the caller can close() it on unmount.
 */
export function openJobStream(
  onJob: (job: JobRecord) => void,
  onSnapshot: (jobs: JobRecord[]) => void,
): EventSource {
  const source = new EventSource(
    `${window.location.origin}/api/jobs/stream`,
    { withCredentials: true },
  );
  source.addEventListener("snapshot", (e) => {
    onSnapshot(JSON.parse((e as MessageEvent).data) as JobRecord[]);
  });
  source.addEventListener("job", (e) => {
    onJob(JSON.parse((e as MessageEvent).data) as JobRecord);
  });
  return source;
}

// --- Recordings analysis client (/api/analysis) --------------------------
// Read-only admin analytics (storage/duration summary + hourly gap analysis);
// both routes are behind requireAuth, so the same-origin session cookie travels
// with each request and ApiError surfaces the backend's {error, field}.

/** GET /api/analysis/summary -> per-stream + overall recording roll-up. */
export async function getAnalysisSummary(): Promise<AnalysisSummary> {
  const res = await fetch(`${window.location.origin}/api/analysis/summary`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as AnalysisSummary;
}

/**
 * GET /api/analysis/gaps?folder=&start=&end= -> hourly coverage for one folder
 * over an inclusive date range (YYYY-MM-DD). Throws ApiError on the backend's
 * 400 validation failures (folder required, start/end format, start <= end).
 */
export async function getAnalysisGaps(
  folder: string,
  start: string,
  end: string,
): Promise<AnalysisGaps> {
  const params = new URLSearchParams({ folder, start, end });
  const res = await fetch(
    `${window.location.origin}/api/analysis/gaps?${params.toString()}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as AnalysisGaps;
}

/**
 * GET /api/analysis/stream-health?windowHours=N -> per-stream two-signal health
 * (recording-now check + last-24h gap summary) over a recent window plus a
 * recording-now roll-up. windowHours is optional (default 24, server-side range
 * 1..168); throws ApiError on a 400 validation failure.
 */
export async function getStreamHealth(
  windowHours?: number,
): Promise<StreamHealthResponse> {
  const query =
    windowHours === undefined ? "" : `?windowHours=${windowHours}`;
  const res = await fetch(
    `${window.location.origin}/api/analysis/stream-health${query}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as StreamHealthResponse;
}

/**
 * GET /api/analysis/storage-estimate -> projected steady-state disk usage per
 * stream + total over the configured retention window, plus the actual bytes
 * currently on disk. Throws ApiError on a non-2xx response.
 */
export async function getStorageEstimate(): Promise<StorageEstimateResponse> {
  const res = await fetch(
    `${window.location.origin}/api/analysis/storage-estimate`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as StorageEstimateResponse;
}
