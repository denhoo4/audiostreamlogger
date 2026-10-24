// Typed client for the existing Express backend (frontend/index.js + routes/).
// All requests target the same origin: no base URL, no extra CORS assumptions
// beyond what the backend already sets. The backend is NOT modified by this app.

/** A single stream as returned by GET /api/settings (public player selector). */
export interface Stream {
  country: string;
  name: string;
  folder: string;
  url: string;
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
  created_at: string;
  updated_at: string;
}

/** Writable stream fields for create/update (no id/timestamps). */
export type StreamInput = Pick<
  StreamRecord,
  "country" | "name" | "folder" | "url"
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

// --- Branding client (/api/app-config + /api/branding) -------------------

/**
 * GET /api/app-config/public -> runtime branding read by the public player
 * (page title). No credentials: this endpoint is unauthenticated.
 */
export async function getPublicConfig(): Promise<{ title: string }> {
  const res = await fetch(
    `${window.location.origin}/api/app-config/public`,
  );
  if (!res.ok) {
    throw await toApiError(res);
  }
  return (await res.json()) as { title: string };
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

/** DELETE /api/streams/:id -> remove a stream. */
export async function deleteStream(id: number): Promise<void> {
  const res = await fetch(`${window.location.origin}/api/streams/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw await toApiError(res);
  }
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
