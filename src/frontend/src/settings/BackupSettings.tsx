import { useRef, useState } from "react";
import {
  Alert,
  Button,
  FileInput,
  Group,
  List,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  ApiError,
  downloadDb,
  exportBackup,
  importBackup,
  type ImportResult,
} from "../api";
import { Panel } from "../ui";

/**
 * Backup admin section (task feature 5 / S2). Three actions:
 *   - Download backup (JSON): authenticated fetch -> Blob -> anchor download.
 *   - Download raw database: same, for the raw app.db octet-stream.
 *   - Import: read the chosen JSON file, POST it, and render a summary of
 *     imported/updated counts plus any skipped streams / config keys.
 * ApiError messages are surfaced the same way as the other settings components.
 *
 * Restyled to the Mantine AI-Studio house style (Panel + Mantine
 * FileInput/Button/List/Alert); the saveBlob/dateStamp helpers, the invalid
 * JSON inline error, the file-input ref/reset and the <h2> heading are
 * preserved verbatim.
 */
export default function BackupSettings() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLButtonElement | null>(null);

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
      <Title order={2}>Backup</Title>

      <Panel mt="md">
        <Stack gap="sm">
          <Title order={3}>Export</Title>
          <Group>
            <Button type="button" onClick={handleExportJson}>
              Download backup (JSON)
            </Button>
            <Button type="button" variant="default" onClick={handleExportDb}>
              Download raw database
            </Button>
          </Group>
        </Stack>
      </Panel>

      <Panel mt="md">
        <Stack gap="sm">
          <Title order={3}>Import</Title>
          <FileInput
            ref={fileInputRef}
            label="Backup file (JSON)"
            placeholder="Choose a file…"
            accept="application/json,.json"
            value={file}
            onChange={setFile}
          />
          <Group>
            <Button type="button" onClick={handleImport}>
              Import
            </Button>
          </Group>
        </Stack>
      </Panel>

      {error && (
        <Alert color="red" role="alert" mt="md">
          {error}
        </Alert>
      )}
      {status && (
        <Text role="status" c="dimmed" mt="md">
          {status}
        </Text>
      )}

      {result && (
        <Panel mt="md">
          <Stack gap="sm">
            <Title order={3}>Import result</Title>
            <List>
              <List.Item>Imported (new): {result.imported}</List.Item>
              <List.Item>Updated (existing): {result.updated}</List.Item>
              <List.Item>
                Config applied: {result.config_applied.join(", ") || "none"}
              </List.Item>
            </List>
            {result.skipped.length > 0 && (
              <Stack gap="xs">
                <Text>Skipped streams:</Text>
                <List>
                  {result.skipped.map((s, i) => (
                    <List.Item key={i}>
                      {s.folder ?? "(no folder)"}: {s.reason}
                    </List.Item>
                  ))}
                </List>
              </Stack>
            )}
            {result.config_skipped && result.config_skipped.length > 0 && (
              <Stack gap="xs">
                <Text>Skipped config keys:</Text>
                <List>
                  {result.config_skipped.map((c, i) => (
                    <List.Item key={i}>
                      {c.key}: {c.reason}
                    </List.Item>
                  ))}
                </List>
              </Stack>
            )}
          </Stack>
        </Panel>
      )}
    </section>
  );
}
