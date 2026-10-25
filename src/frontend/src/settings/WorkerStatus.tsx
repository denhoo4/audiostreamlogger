import { useEffect, useState } from "react";
import { Alert, List, Text, Title } from "@mantine/core";
import { ApiError, getWorkerStatus, type JobRecord } from "../api";
import { Panel, StatusBadge } from "../ui";

// Poll cadence; the worker writes its heartbeat on a 5s timer, so matching that
// keeps the "last seen Xs ago" readout fresh without hammering the endpoint.
const POLL_MS = 5000;
// A heartbeat older than this marks the worker as stale (missed a few beats).
const STALE_MS = 30 * 1000;

interface Status {
  last_heartbeat: string | null;
  status: string | null;
  current_job: JobRecord | null;
}

/** Whole seconds since an ISO timestamp, or null when unparseable/absent. */
function ageSeconds(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

/**
 * Worker liveness panel (task feature 4 / S1). Polls GET /api/worker/status
 * every 5s (cleared on unmount) and shows whether the worker is alive (heartbeat
 * age < 30s) or stale, how long ago it was last seen, and the job it is
 * currently running (type + status) or "idle". Errors are surfaced minimally.
 *
 * Restyled to the Mantine AI-Studio house style (Panel + StatusBadge + List);
 * the 5s poll + 1s clock intervals and their cleanup, and the
 * alive/stale/age/current-job logic, are preserved verbatim — only presentation
 * changed.
 */
export default function WorkerStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-render tick so "last seen Xs ago" keeps counting between polls.
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await getWorkerStatus();
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Could not load worker status",
          );
        }
      }
    }

    void poll();
    const pollTimer = setInterval(() => void poll(), POLL_MS);
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, []);

  const age = ageSeconds(status?.last_heartbeat ?? null, now);
  const alive = age !== null && age * 1000 < STALE_MS;
  const job = status?.current_job ?? null;

  return (
    <section className="settings-section">
      <Title order={2}>Worker status</Title>

      {error && (
        <Alert color="red" role="alert" mt="md">
          {error}
        </Alert>
      )}

      {!status && !error ? (
        <Text c="dimmed" mt="md">
          Loading…
        </Text>
      ) : (
        <Panel mt="md">
          <List spacing="xs">
            <List.Item>
              Worker:{" "}
              {age === null ? (
                <StatusBadge status="never">unknown</StatusBadge>
              ) : alive ? (
                <StatusBadge status="ok">alive</StatusBadge>
              ) : (
                <StatusBadge status="down">stale</StatusBadge>
              )}
            </List.Item>
            <List.Item>
              Last seen: {age === null ? "never" : `${age}s ago`}
            </List.Item>
            <List.Item>
              Current job: {job ? `${job.type} (${job.status})` : "idle"}
            </List.Item>
          </List>
        </Panel>
      )}
    </section>
  );
}
