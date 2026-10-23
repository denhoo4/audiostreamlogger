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
  type: "cleaner" | "peakfilegenerator";
  trigger_source: "manual" | "schedule";
  status: "pending" | "running" | "done" | "failed" | "skipped";
  output: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** A schedule row as returned by GET /api/schedules (requireAuth). */
export interface ScheduleRecord {
  type: "cleaner" | "peakfilegenerator";
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
