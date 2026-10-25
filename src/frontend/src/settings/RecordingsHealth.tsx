import { useEffect, useState } from "react";
import { Box, Group, List, Table, Text, Title } from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import {
  ApiError,
  getAnalysisSummary,
  getStorageEstimate,
  getStreamHealth,
  type AnalysisStreamSummary,
  type StorageEstimatePerStream,
  type StreamHealthEntry,
} from "../api";
import { AsyncState, Panel, StatusBadge } from "../ui";

/** Human-readable byte size (1024-based). Copied from StorageEstimate. */
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
function formatSlot(slot: string | null | undefined): string {
  return slot ?? "—";
}

/** The two prominent summary lines; null until the storage estimate loads. */
interface Totals {
  totalProjectedBytes: number;
  retentionHours: number;
  actualBytes: number;
}

/**
 * One merged per-stream row, keyed by folder. Every source is optional so a
 * stream present in one endpoint but missing from another degrades gracefully
 * (the relevant cells show '—').
 */
interface MergedRow {
  folder: string;
  name: string;
  summary?: AnalysisStreamSummary;
  health?: StreamHealthEntry;
  estimate?: StorageEstimatePerStream;
}

/**
 * Merge the three analysis endpoints client-side keyed by stream FOLDER:
 * summary.per_stream[].stream_folder, streamHealth.streams[].folder and
 * storageEstimate.projection.perStream[].folder all identify the same stream.
 * The display name comes from the health or storage-estimate entry (both carry
 * `name`); the analysis summary carries only the folder, so it falls back to
 * the folder when neither name source has the stream.
 */
function mergeRows(
  summaries: AnalysisStreamSummary[],
  health: StreamHealthEntry[],
  estimates: StorageEstimatePerStream[],
): MergedRow[] {
  const rows = new Map<string, MergedRow>();

  const ensure = (folder: string): MergedRow => {
    let row = rows.get(folder);
    if (!row) {
      row = { folder, name: folder };
      rows.set(folder, row);
    }
    return row;
  };

  for (const s of summaries) {
    ensure(s.stream_folder).summary = s;
  }
  for (const h of health) {
    const row = ensure(h.folder);
    row.health = h;
    row.name = h.name;
  }
  for (const e of estimates) {
    const row = ensure(e.folder);
    row.estimate = e;
    // Health name wins when present; otherwise take the estimate's name.
    if (!row.health) row.name = e.name;
  }

  return Array.from(rows.values());
}

/**
 * Merged 'Recordings & health' admin section (FEAT-001). On mount it loads
 * GET /api/analysis/summary, /stream-health and /storage-estimate in parallel
 * and renders ONE per-stream table inside a single Panel, with two prominent
 * summary lines (projected total + currently on disk) above it. Replaces the
 * former RecordingsAnalysis + StreamHealth + StorageEstimate panels; the old
 * Gaps & coverage UI is intentionally dropped. Loading (Loader + dimmed Text)
 * and ApiError (<Alert color='red' role='alert'>) states mirror those panels.
 */
export default function RecordingsHealth() {
  const [rows, setRows] = useState<MergedRow[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [summary, health, storage] = await Promise.all([
          getAnalysisSummary(),
          getStreamHealth(),
          getStorageEstimate(),
        ]);
        if (cancelled) return;
        setRows(
          mergeRows(
            summary.per_stream,
            health.streams,
            storage.projection.perStream,
          ),
        );
        setTotals({
          totalProjectedBytes: storage.projection.totalProjectedBytes,
          retentionHours: storage.retention_hours,
          actualBytes: storage.actual_bytes,
        });
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not load recordings & health",
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
      <Title order={2}>Recordings &amp; health</Title>

      <Box mt="md">
        <AsyncState loading={!rows && !error} error={error}>
          {rows && totals ? (
            <>
              <List>
            <List.Item>
              Projected total:{" "}
              <Text span fw={700}>
                {formatBytes(totals.totalProjectedBytes)}
              </Text>{" "}
              over {totals.retentionHours}h retention
            </List.Item>
            <List.Item>
              Currently on disk:{" "}
              <Text span fw={700}>
                {formatBytes(totals.actualBytes)}
              </Text>
            </List.Item>
          </List>

              <Panel mt="md">
                <AsyncState
                  empty={rows.length === 0}
                  emptyMessage="No recordings yet."
                >
                  <Table.ScrollContainer minWidth={720} type="native">
                <Table verticalSpacing="xs" horizontalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Stream</Table.Th>
                      <Table.Th>Total hours</Table.Th>
                      <Table.Th>Storage</Table.Th>
                      <Table.Th>Range</Table.Th>
                      <Table.Th>Health</Table.Th>
                      <Table.Th>Bytes/hour</Table.Th>
                      <Table.Th>Projected size</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rows.map((row) => (
                      <Table.Tr key={row.folder}>
                        <Table.Td>{row.name}</Table.Td>
                        <Table.Td>{row.summary?.total_hours ?? "—"}</Table.Td>
                        <Table.Td>
                          {row.summary
                            ? formatBytes(row.summary.storage_bytes)
                            : "—"}
                        </Table.Td>
                        <Table.Td>
                          {row.summary
                            ? `${formatSlot(row.summary.earliest)} – ${formatSlot(
                                row.summary.latest,
                              )}`
                            : "—"}
                        </Table.Td>
                        <Table.Td>
                          {row.health ? (
                            row.health.recordingNow ? (
                              <IconCheck
                                size={18}
                                color="var(--mantine-color-green-6)"
                                role="img"
                                aria-label="recording now"
                              />
                            ) : (
                              <IconX
                                size={18}
                                color="var(--mantine-color-red-6)"
                                role="img"
                                aria-label="not recording"
                              />
                            )
                          ) : (
                            "—"
                          )}
                        </Table.Td>
                        <Table.Td>
                          {row.estimate ? (
                            <Group gap="xs" wrap="nowrap">
                              <span>
                                {formatBytes(row.estimate.bytesPerHour)}/h
                              </span>
                              <StatusBadge
                                status={
                                  row.estimate.source === "measured"
                                    ? "ok"
                                    : "never"
                                }
                              >
                                {row.estimate.source}
                              </StatusBadge>
                            </Group>
                          ) : (
                            "—"
                          )}
                        </Table.Td>
                        <Table.Td>
                          {row.estimate
                            ? formatBytes(row.estimate.projectedBytes)
                            : "—"}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                  </Table.ScrollContainer>
                </AsyncState>
              </Panel>
            </>
          ) : null}
        </AsyncState>
      </Box>
    </section>
  );
}
