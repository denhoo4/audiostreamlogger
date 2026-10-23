import { useRef, useState } from "react";
import {
  ApiError,
  downloadDb,
  exportBackup,
  importBackup,
  type ImportResult,
} from "../api";

/**
 * Backup admin section (task feature 5 / S2). Three actions:
 *   - Download backup (JSON): authenticated fetch -> Blob -> anchor download.
 *   - Download raw database: same, for the raw app.db octet-stream.
 *   - Import: read the chosen JSON file, POST it, and render a summary of
 *     imported/updated counts plus any skipped streams / config keys.
 * ApiError messages are surfaced the same way as the other settings components.
 */
export default function BackupSettings() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Trigger a browser download of a Blob under the given filename. */
  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function dateStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async function handleExportJson() {
    setError(null);
    setStatus("Preparing backup…");
    try {
      const blob = await exportBackup();
      saveBlob(blob, `audiostreamlogger-backup-${dateStamp()}.json`);
      setStatus("Backup downloaded");
    } catch (err) {
      setStatus(null);
      setError(
        err instanceof ApiError ? err.message : "Could not export backup",
      );
    }
  }

  async function handleExportDb() {
    setError(null);
    setStatus("Preparing database…");
    try {
      const blob = await downloadDb();
      saveBlob(blob, "app.db");
      setStatus("Database downloaded");
    } catch (err) {
      setStatus(null);
      setError(
        err instanceof ApiError ? err.message : "Could not download database",
      );
    }
  }

  async function handleImport() {
    if (!file) {
      setError("Choose a backup file first");
      return;
    }
    setError(null);
    setResult(null);
    setStatus("Importing…");
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setStatus(null);
        setError("Selected file is not valid JSON");
        return;
      }
      const summary = await importBackup(parsed);
      setResult(summary);
      setStatus("Import complete");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setStatus(null);
      setError(
        err instanceof ApiError ? err.message : "Could not import backup",
      );
    }
  }

  return (
    <section className="settings-section">
      <h2>Backup</h2>

      <div className="settings-form">
        <h3>Export</h3>
        <div className="settings-form-actions">
          <button type="button" onClick={handleExportJson}>
            Download backup (JSON)
          </button>
          <button type="button" onClick={handleExportDb}>
            Download raw database
          </button>
        </div>
      </div>

      <div className="settings-form">
        <h3>Import</h3>
        <label>
          Backup file (JSON)
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="settings-form-actions">
          <button type="button" onClick={handleImport}>
            Import
          </button>
        </div>
      </div>

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {status && <p>{status}</p>}

      {result && (
        <div className="settings-form">
          <h3>Import result</h3>
          <ul>
            <li>Imported (new): {result.imported}</li>
            <li>Updated (existing): {result.updated}</li>
            <li>Config applied: {result.config_applied.join(", ") || "none"}</li>
          </ul>
          {result.skipped.length > 0 && (
            <>
              <p>Skipped streams:</p>
              <ul>
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    {s.folder ?? "(no folder)"}: {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.config_skipped && result.config_skipped.length > 0 && (
            <>
              <p>Skipped config keys:</p>
              <ul>
                {result.config_skipped.map((c, i) => (
                  <li key={i}>
                    {c.key}: {c.reason}
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
