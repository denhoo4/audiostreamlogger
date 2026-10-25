import { useEffect, useState } from "react";
import {
  Alert,
  Group,
  Loader,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconCheck, IconX } from "@tabler/icons-react";
import {
  ApiError,
  getStreamHealth,
  type StreamHealthEntry,
  type StreamHealthResponse,
} from "../api";
import { Panel } from "../ui";

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
 *
 * Restyled to the Mantine AI-Studio house style (Panel + Mantine Table); the
 * api.ts call, the not-recording-first sort, the header summary string, the
 * 'recording now'/'not recording' accessible names and the <h2> heading are
 * preserved verbatim.
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
      <Title order={2}>Stream health</Title>

      {error && (
        <Alert color="red" role="alert" mt="md">
          {error}
        </Alert>
      )}

      {!data && !error ? (
        <Group gap="xs" mt="md">
          <Loader size="sm" />
          <Text c="dimmed">Loading…</Text>
        </Group>
      ) : data ? (
        <>
          <Text mt="md">
            {`${data.counts.recordingNow}/${data.counts.total} stream${
              data.counts.total === 1 ? "" : "s"
            } recording now (last ${data.window_hours}h)`}
          </Text>

          <Panel mt="md">
            <Table.ScrollContainer minWidth={420} type="native">
              <Table verticalSpacing="xs" horizontalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Stream</Table.Th>
                    <Table.Th>Now</Table.Th>
                    <Table.Th>Last 24h</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {streams.map((s) => (
                    <Table.Tr key={s.folder}>
                      <Table.Td>
                        {s.name}{" "}
                        <Text span c="dimmed">
                          ({s.folder})
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {s.recordingNow ? (
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
                        )}
                      </Table.Td>
                      <Table.Td>{formatLast24h(s.last24h)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Panel>
        </>
      ) : null}
    </section>
  );
}
