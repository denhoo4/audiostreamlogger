import { useEffect, useState } from "react";
import {
  Alert,
  Group,
  List,
  Loader,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  ApiError,
  getStorageEstimate,
  type StorageEstimateResponse,
} from "../api";
import { Panel, StatusBadge } from "../ui";

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
 *
 * Restyled to the Mantine AI-Studio house style (Panel + Mantine Table + a
 * StatusBadge for the measured/estimated source); the api.ts call, all
 * human-readable output (bytes, 'measured'/'estimated' text) and the <h2>
 * heading are preserved verbatim.
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
      <Title order={2}>Storage estimate</Title>

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
          <List mt="md">
            <List.Item>
              Projected total:{" "}
              <Text span fw={700}>
                {formatBytes(data.projection.totalProjectedBytes)}
              </Text>{" "}
              over {data.retention_hours}h retention
            </List.Item>
            <List.Item>
              Currently on disk: {formatBytes(data.actual_bytes)}
            </List.Item>
          </List>

          {data.projection.perStream.length === 0 ? (
            <Text c="dimmed" mt="md">
              No streams configured.
            </Text>
          ) : (
            <Panel mt="md">
              <Table.ScrollContainer minWidth={480} type="native">
                <Table verticalSpacing="xs" horizontalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Stream</Table.Th>
                      <Table.Th>Bytes/hour</Table.Th>
                      <Table.Th>Source</Table.Th>
                      <Table.Th>Projected size</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.projection.perStream.map((s) => (
                      <Table.Tr key={s.folder}>
                        <Table.Td>{s.name}</Table.Td>
                        <Table.Td>{formatBytes(s.bytesPerHour)}/h</Table.Td>
                        <Table.Td>
                          <StatusBadge
                            status={s.source === "measured" ? "ok" : "never"}
                          >
                            {s.source}
                          </StatusBadge>
                        </Table.Td>
                        <Table.Td>{formatBytes(s.projectedBytes)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Panel>
          )}
        </>
      ) : null}
    </section>
  );
}
