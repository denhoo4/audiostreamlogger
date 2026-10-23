import { useEffect, useState } from "react";
import { ApiError, getWorkerStatus, type JobRecord } from "../api";

// Poll cadence; the worker writes its heartbeat on a 5s timer, so matching that
// keeps the "last seen Xs ago" readout fresh without hammering the endpoint.
const POLL_MS = 5000;
// A heartbeat older than this marks the worker as stale (missed a few beats).
const STALE_MS = 30 * 1000;

interface Status {
  last_heartbeat: string | null;
  status: string | null;
  current_job: JobRecord | null;
}

/** Whole seconds since an ISO timestamp, or null when unparseable/absent. */
function ageSeconds(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

/**
 * Worker liveness panel (task feature 4 / S1). Polls GET /api/worker/status
 * every 5s (cleared on unmount) and shows whether the worker is alive (heartbeat
 * age < 30s) or stale, how long ago it was last seen, and the job it is
 * currently running (type + status) or "idle". Errors are surfaced minimally.
 */
export default function WorkerStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-render tick so "last seen Xs ago" keeps counting between polls.
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await getWorkerStatus();
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Could not load worker status",
          );
        }
      }
    }

    void poll();
    const pollTimer = setInterval(() => void poll(), POLL_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, []);

  const age = ageSeconds(status?.last_heartbeat ?? null, now);
  const alive = age !== null && age * 1000 < STALE_MS;
  const job = status?.current_job ?? null;

  return (
    <section className="settings-section">
      <h2>Worker status</h2>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {!status && !error ? (
        <p>Loading…</p>
      ) : (
        <ul>
          <li>
            Worker: {age === null ? "unknown" : alive ? "alive" : "stale"}
          </li>
          <li>
            Last seen: {age === null ? "never" : `${age}s ago`}
          </li>
          <li>
            Current job:{" "}
            {job ? `${job.type} (${job.status})` : "idle"}
          </li>
        </ul>
      )}
    </section>
  );
}
