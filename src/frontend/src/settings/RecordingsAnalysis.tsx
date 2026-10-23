import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApiError,
  getAnalysisGaps,
  getAnalysisSummary,
  type AnalysisGaps,
  type AnalysisStreamSummary,
  type AnalysisSummary,
} from "../api";

/** Human-readable byte size (1024-based) for the storage column. */
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

/** 'YYYY-MM-DD-HH' slot key as a readable range endpoint, or a dash when null. */
function formatSlot(slot: string | null): string {
  return slot ?? "—";
}

/** Rounded whole-second average duration, or a dash when unknown. */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  return `${Math.round(seconds)}s`;
}

/**
 * Recordings analysis admin section (FEAT-004). On mount it loads
 * GET /api/analysis/summary and renders a per-stream table (folder, total
 * hours, storage, recording count, date range). Below it a gaps/coverage panel
 * lets an operator pick a stream + date range and call GET /api/analysis/gaps,
 * showing expected vs present counts, the coverage ratio, and the list of
 * missing hour slots. Loading + ApiError states mirror the other sections.
 */
export default function RecordingsAnalysis() {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [folder, setFolder] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [gaps, setGaps] = useState<AnalysisGaps | null>(null);
  const [gapsError, setGapsError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await getAnalysisSummary();
        if (!cancelled) {
          setSummary(next);
          setSummaryError(null);
          // Default the gaps selector to the first stream, if any.
          if (next.per_stream.length > 0 && folder === "") {
            setFolder(next.per_stream[0].stream_folder);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setSummaryError(
            err instanceof ApiError
              ? err.message
              : "Could not load analysis summary",
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // folder is intentionally excluded: this effect only runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const streams: AnalysisStreamSummary[] = useMemo(
    () => summary?.per_stream ?? [],
    [summary],
  );

  async function handleCheckGaps(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    setGapsError(null);
    try {
      const next = await getAnalysisGaps(folder, start, end);
      setGaps(next);
    } catch (err) {
      setGaps(null);
      setGapsError(
        err instanceof ApiError ? err.message : "Could not load gaps",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="settings-section">
      <h2>Recordings analysis</h2>

      {summaryError && (
        <p className="settings-error" role="alert">
          {summaryError}
        </p>
      )}

      {!summary && !summaryError ? (
        <p>Loading…</p>
      ) : streams.length === 0 ? (
        <p>No recordings yet.</p>
      ) : (
        <table className="analysis-table">
          <thead>
            <tr>
              <th>Stream</th>
              <th>Total hours</th>
              <th>Storage</th>
              <th>Recordings</th>
              <th>Avg duration</th>
              <th>Range</th>
            </tr>
          </thead>
          <tbody>
            {streams.map((s) => (
              <tr key={s.stream_folder}>
                <td>{s.stream_folder}</td>
                <td>{s.total_hours}</td>
                <td>{formatBytes(s.storage_bytes)}</td>
                <td>{s.recording_count}</td>
                <td>{formatDuration(s.avg_duration_seconds)}</td>
                <td>
                  {formatSlot(s.earliest)} – {formatSlot(s.latest)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Gaps &amp; coverage</h3>
      <form className="analysis-gaps-form" onSubmit={handleCheckGaps}>
        <label>
          Stream
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            {streams.length === 0 && <option value="">(none)</option>}
            {streams.map((s) => (
              <option key={s.stream_folder} value={s.stream_folder}>
                {s.stream_folder}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          End
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button type="submit" disabled={checking || streams.length === 0}>
          {checking ? "Checking…" : "Check gaps"}
        </button>
      </form>

      {gapsError && (
        <p className="settings-error" role="alert">
          {gapsError}
        </p>
      )}

      {gaps && (
        <div className="analysis-gaps-result">
          <ul>
            <li>Folder: {gaps.folder}</li>
            <li>
              Range: {gaps.start} – {gaps.end}
            </li>
            <li>
              Coverage: {gaps.present_count} / {gaps.expected_count} slots (
              {Math.round(gaps.coverage_ratio * 100)}%)
            </li>
          </ul>
          {gaps.missing.length === 0 ? (
            <p>No missing slots in this range.</p>
          ) : (
            <>
              <p>Missing slots ({gaps.missing.length}):</p>
              <ul className="analysis-missing-list">
                {gaps.missing.map((m) => (
                  <li key={`${m.date}-${m.hour}`}>
                    {m.date} {m.hour}:00
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
