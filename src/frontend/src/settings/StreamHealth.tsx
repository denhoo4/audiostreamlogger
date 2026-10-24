import { useEffect, useState } from "react";
import {
  ApiError,
  getStreamHealth,
  type StreamHealthEntry,
  type StreamHealthResponse,
} from "../api";

/**
 * Short, informational "Last 24h" gap summary for a stream: "complete" when
 * there are no gaps, else the gap count plus the Amsterdam-local hour labels
 * (HH:00) of the missing slots, e.g. "3 gaps: 02:00, 05:00, 06:00". The
 * in-progress current hour is already excluded server-side.
 */
function formatLast24h(last24h: StreamHealthEntry["last24h"]): string {
  if (last24h.complete) {
    return "complete";
  }
  const labels = last24h.gaps.map((g) => `${g.hour}:00`).join(", ");
  return `${last24h.gapCount} gap${last24h.gapCount === 1 ? "" : "s"}: ${labels}`;
}

/**
 * Stream health overview (TODO item 21). On mount it loads
 * GET /api/analysis/stream-health (default 24h window) and shows, per stream,
 * TWO independent signals in two columns:
 *   - "Now": a green check when the stream is recording the CURRENT hour-slot,
 *     else a "not recording" marker. Decided ONLY from the current hour — the
 *     24h gap history never drives this column.
 *   - "Last 24h": a short gap summary ("complete" or "N gaps: HH:00, …").
 * Streams that are NOT recording now sort to the top so problems are visible.
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

  // Not-recording streams sort to the top (recordingNow ascending: false first).
  const streams =
    data?.streams
      .slice()
      .sort((a, b) => Number(a.recordingNow) - Number(b.recordingNow)) ?? [];

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
            {`${data.counts.recordingNow}/${data.counts.total} stream${
              data.counts.total === 1 ? "" : "s"
            } recording now (last ${data.window_hours}h)`}
          </p>

          <table className="settings-table stream-health-table">
            <thead>
              <tr>
                <th>Stream</th>
                <th>Now</th>
                <th>Last 24h</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((s) => (
                <tr key={s.folder} className="stream-health-row">
                  <td className="stream-health-name">
                    {s.name}{" "}
                    <span className="stream-health-folder">({s.folder})</span>
                  </td>
                  <td className="stream-health-now">
                    {s.recordingNow ? (
                      <span
                        className="stream-health-check"
                        role="img"
                        aria-label="recording now"
                        title="recording now"
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        className="stream-health-nocheck"
                        role="img"
                        aria-label="not recording"
                        title="not recording"
                      >
                        ✗
                      </span>
                    )}
                  </td>
                  <td className="stream-health-last24h">
                    {formatLast24h(s.last24h)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
