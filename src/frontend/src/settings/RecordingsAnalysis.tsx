import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Group,
  List,
  Loader,
  NativeSelect,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  ApiError,
  getAnalysisGaps,
  getAnalysisSummary,
  type AnalysisGaps,
  type AnalysisStreamSummary,
  type AnalysisSummary,
} from "../api";
import { Panel } from "../ui";

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
 *
 * Restyled to the Mantine AI-Studio house style (Panel + Mantine Table/forms);
 * all api.ts calls, human-readable output, the <h2> heading and the behaviour
 * are preserved verbatim.
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

  const streamData =
    streams.length === 0
      ? [{ value: "", label: "(none)" }]
      : streams.map((s) => ({
          value: s.stream_folder,
          label: s.stream_folder,
        }));

  return (
    <section className="settings-section">
      <Title order={2}>Recordings analysis</Title>

      {summaryError && (
        <Alert color="red" role="alert" mt="md">
          {summaryError}
        </Alert>
      )}

      <Panel mt="md">
        {!summary && !summaryError ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text c="dimmed">Loading…</Text>
          </Group>
        ) : streams.length === 0 ? (
          <Text c="dimmed">No recordings yet.</Text>
        ) : (
          <Table.ScrollContainer minWidth={640} type="native">
            <Table verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Stream</Table.Th>
                  <Table.Th>Total hours</Table.Th>
                  <Table.Th>Storage</Table.Th>
                  <Table.Th>Recordings</Table.Th>
                  <Table.Th>Avg duration</Table.Th>
                  <Table.Th>Range</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {streams.map((s) => (
                  <Table.Tr key={s.stream_folder}>
                    <Table.Td>{s.stream_folder}</Table.Td>
                    <Table.Td>{s.total_hours}</Table.Td>
                    <Table.Td>{formatBytes(s.storage_bytes)}</Table.Td>
                    <Table.Td>{s.recording_count}</Table.Td>
                    <Table.Td>{formatDuration(s.avg_duration_seconds)}</Table.Td>
                    <Table.Td>
                      {formatSlot(s.earliest)} – {formatSlot(s.latest)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Panel>

      <Title order={3} mt="lg">
        Gaps &amp; coverage
      </Title>
      <Panel mt="md">
        <form onSubmit={handleCheckGaps}>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <NativeSelect
              label="Stream"
              value={folder}
              onChange={(e) => setFolder(e.currentTarget.value)}
              data={streamData}
            />
            <TextInput
              label="Start"
              type="date"
              value={start}
              onChange={(e) => setStart(e.currentTarget.value)}
            />
            <TextInput
              label="End"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.currentTarget.value)}
            />
            <Button
              type="submit"
              disabled={checking || streams.length === 0}
            >
              {checking ? "Checking…" : "Check gaps"}
            </Button>
          </Group>
        </form>

        {gapsError && (
          <Alert color="red" role="alert" mt="md">
            {gapsError}
          </Alert>
        )}

        {gaps && (
          <Stack gap="xs" mt="md">
            <List>
              <List.Item>Folder: {gaps.folder}</List.Item>
              <List.Item>
                Range: {gaps.start} – {gaps.end}
              </List.Item>
              <List.Item>
                Coverage: {gaps.present_count} / {gaps.expected_count} slots (
                {Math.round(gaps.coverage_ratio * 100)}%)
              </List.Item>
            </List>
            {gaps.missing.length === 0 ? (
              <Text>No missing slots in this range.</Text>
            ) : (
              <>
                <Text>Missing slots ({gaps.missing.length}):</Text>
                <List>
                  {gaps.missing.map((m) => (
                    <List.Item key={`${m.date}-${m.hour}`}>
                      {m.date} {m.hour}:00
                    </List.Item>
                  ))}
                </List>
              </>
            )}
          </Stack>
        )}
      </Panel>
    </section>
  );
}
