import { useEffect, useState } from "react";
import {
  ApiError,
  getStorageEstimate,
  type StorageEstimateResponse,
} from "../api";

/** Human-readable byte size (1024-based), mirroring RecordingsAnalysis. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, exp);
  const rounded = exp === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[exp]}`;
}

/**
 * Storage-estimate admin section (TODO item 23). On mount it loads
 * GET /api/analysis/storage-estimate and renders the projected steady-state
 * total over the configured retention window, the current actual on-disk total,
 * and a per-stream table (stream, bytes/hour, a measured/estimated badge, and
 * the projected size). Loading + ApiError states mirror RecordingsAnalysis.
 */
export default function StorageEstimate() {
  const [data, setData] = useState<StorageEstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await getStorageEstimate();
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not load storage estimate",
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="settings-section">
      <h2>Storage estimate</h2>

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}

      {!data && !error ? (
        <p>Loading…</p>
      ) : data ? (
        <>
          <ul className="storage-estimate-summary">
            <li>
              Projected total:{" "}
              <strong>{formatBytes(data.projection.totalProjectedBytes)}</strong>{" "}
              over {data.retention_hours}h retention
            </li>
            <li>Currently on disk: {formatBytes(data.actual_bytes)}</li>
          </ul>

          {data.projection.perStream.length === 0 ? (
            <p>No streams configured.</p>
          ) : (
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>Stream</th>
                  <th>Bytes/hour</th>
                  <th>Source</th>
                  <th>Projected size</th>
                </tr>
              </thead>
              <tbody>
                {data.projection.perStream.map((s) => (
                  <tr key={s.folder}>
                    <td>{s.name}</td>
                    <td>{formatBytes(s.bytesPerHour)}/h</td>
                    <td>
                      <span
                        className={`storage-estimate-badge storage-estimate-badge-${s.source}`}
                      >
                        {s.source}
                      </span>
                    </td>
                    <td>{formatBytes(s.projectedBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </section>
  );
}
