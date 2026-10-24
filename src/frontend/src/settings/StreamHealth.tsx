import { useEffect, useState } from "react";
import {
  ApiError,
  getStreamHealth,
  type StreamHealthEntry,
  type StreamHealthResponse,
} from "../api";

// Order problem streams by severity so the worst offenders sit at the top.
const STATUS_RANK: Record<StreamHealthEntry["status"], number> = {
  down: 0,
  degraded: 1,
  never: 2,
  ok: 3,
};

/** Human label for a status badge. */
function statusLabel(status: StreamHealthEntry["status"]): string {
  switch (status) {
    case "down":
      return "down";
    case "degraded":
      return "degraded";
    case "never":
      return "never recorded";
    case "ok":
      return "ok";
  }
}

/** 'YYYY-MM-DD HH:00' for a last-successful slot, or a dash when null. */
function formatSlot(slot: { date: string; hour: string } | null): string {
  if (!slot) return "—";
  return `${slot.date} ${slot.hour}:00`;
}

/** "N missing hours" for a trailing failing run, or a dash when zero. */
function formatMissing(count: number): string {
  if (count <= 0) return "—";
  return `${count} missing hour${count === 1 ? "" : "s"}`;
}

/**
 * Stream health overview (TODO item 21). On mount it loads
 * GET /api/analysis/stream-health (default 24h window) and surfaces, at a
 * glance, which streams are NOT working. Problem streams (down/degraded/never)
 * are listed first with their symptom — a status badge, the trailing
 * consecutive-missing count, and the last successful hour (or "no recordings
 * yet" for a never-recorded stream). Healthy streams are summarised compactly.
 * Loading + ApiError states mirror WorkerStatus.tsx / RecordingsAnalysis.tsx.
 */
export default function StreamHealth() {
  const [data, setData] = useState<StreamHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await getStreamHealth();
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not load stream health",
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const problems =
    data?.streams
      .filter((s) => s.status !== "ok")
      .slice()
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]) ?? [];
  const okCount = data?.counts.ok ?? 0;

  return (
    <section className="settings-section">
      <h2>Stream health</h2>

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}

      {!data && !error ? (
        <p>Loading…</p>
      ) : data ? (
        <>
          <p>
            {data.unhealthy_count === 0
              ? `All ${data.counts.total} streams OK`
              : `${data.unhealthy_count} stream${
                  data.unhealthy_count === 1 ? "" : "s"
                } need attention (last ${data.window_hours}h)`}
          </p>

          {problems.length > 0 && (
            <ul className="stream-health-list">
              {problems.map((s) => (
                <li
                  key={s.folder}
                  className={`stream-health-item stream-health-item--${s.status}`}
                >
                  <span
                    className={`health-badge health-badge--${s.status}`}
                  >
                    {statusLabel(s.status)}
                  </span>{" "}
                  <span className="stream-health-name">{s.name}</span>{" "}
                  <span className="stream-health-folder">({s.folder})</span>
                  {" — "}
                  {s.status === "never" ? (
                    <span className="stream-health-symptom">
                      no recordings yet
                    </span>
                  ) : (
                    <span className="stream-health-symptom">
                      {formatMissing(s.consecutiveMissing)}, last success{" "}
                      {formatSlot(s.lastSuccessfulSlot)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {data.unhealthy_count > 0 && (
            <p className="stream-health-ok-summary">
              {okCount} stream{okCount === 1 ? "" : "s"} OK
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
