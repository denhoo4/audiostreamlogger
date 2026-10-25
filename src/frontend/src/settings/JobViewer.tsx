import { useEffect, useState } from "react";
import {
  Badge,
  Code,
  Group,
  Stack,
  Text,
  Title,
  type MantineColor,
} from "@mantine/core";
import { openJobStream, type JobRecord } from "../api";
import { Panel } from "../ui";

/**
 * Map a job status to a badge colour + variant. A job that was skipped because
 * the worker was busy ("skipped, busy") renders NEUTRAL (gray), not as an
 * error, so operators do not misread the intended busy-skip semantic
 * (design §6.3/§6.4). failed -> red, done -> green, running -> the theme accent
 * (aiBlue); pending + skipped (incl. "skipped, busy") stay neutral gray.
 */
function badgeProps(job: JobRecord): { color: MantineColor; variant: string } {
  if (job.status === "failed") return { color: "red", variant: "light" };
  if (job.status === "done") return { color: "green", variant: "light" };
  if (job.status === "running") return { color: "aiBlue", variant: "light" };
  // pending + skipped (incl. "skipped, busy") are neutral.
  return { color: "gray", variant: "light" };
}

/** Merge a changed row into the list (replace by id, or prepend if new). */
function mergeJob(jobs: JobRecord[], changed: JobRecord): JobRecord[] {
  const idx = jobs.findIndex((j) => j.id === changed.id);
  if (idx === -1) {
    return [changed, ...jobs];
  }
  const next = jobs.slice();
  next[idx] = changed;
  return next;
}

/** The job types shown, one row each, in this display order. */
const DISPLAY_TYPES: JobRecord["type"][] = [
  "cleaner",
  "peakfilegenerator",
  "reconcile",
];

/**
 * Reduce the full job list to at most one row per type: for each display type
 * pick the job with the newest created_at, tie-broken by the highest id. Types
 * with no job are omitted. Result is ordered per DISPLAY_TYPES.
 */
function latestPerType(jobs: JobRecord[]): JobRecord[] {
  const best = new Map<JobRecord["type"], JobRecord>();
  for (const job of jobs) {
    const current = best.get(job.type);
    if (
      !current ||
      job.created_at > current.created_at ||
      (job.created_at === current.created_at && job.id > current.id)
    ) {
      best.set(job.type, job);
    }
  }
  return DISPLAY_TYPES.map((type) => best.get(type)).filter(
    (job): job is JobRecord => job !== undefined,
  );
}

/**
 * Live job viewer (design §6.4). Opens an EventSource on /api/jobs/stream, keeps
 * the job list in sync as snapshot/job events arrive, and renders only the most
 * recent job of each type (cleaner, peakfilegenerator, reconcile) with its
 * status badge, trigger source, timestamps, and captured output. The
 * EventSource is closed on unmount.
 *
 * Restyled to the Mantine AI-Studio house style (Panel + Mantine Badge/Code);
 * the openJobStream EventSource lifecycle and the mergeJob behaviour are
 * preserved verbatim — only the display is reduced to one row per type via
 * latestPerType.
 */
export default function JobViewer() {
  const [jobs, setJobs] = useState<JobRecord[]>([]);

  useEffect(() => {
    const source = openJobStream(
      (job) => setJobs((prev) => mergeJob(prev, job)),
      (snapshot) => setJobs(snapshot),
    );
    return () => {
      source.close();
    };
  }, []);

  const displayJobs = latestPerType(jobs);

  return (
    <section className="settings-section">
      <Title order={2}>Recent jobs</Title>
      <Panel mt="md">
        {displayJobs.length === 0 ? (
          <Text c="dimmed">No jobs yet.</Text>
        ) : (
          <Stack gap="sm">
            {displayJobs.map((job) => {
              const { color, variant } = badgeProps(job);
              return (
                <Stack key={job.id} gap="xs">
                  <Group gap="sm" wrap="nowrap">
                    <Badge color={color} variant={variant}>
                      {job.status}
                    </Badge>
                    <Text fw={600}>{job.type}</Text>
                    <Text c="dimmed" size="sm">
                      {job.trigger_source}
                    </Text>
                  </Group>
                  <Group gap="md">
                    <Text size="sm" c="dimmed">
                      created: {job.created_at}
                    </Text>
                    <Text size="sm" c="dimmed">
                      started: {job.started_at ?? "—"}
                    </Text>
                    <Text size="sm" c="dimmed">
                      finished: {job.finished_at ?? "—"}
                    </Text>
                  </Group>
                  {job.output && <Code block>{job.output}</Code>}
                </Stack>
              );
            })}
          </Stack>
        )}
      </Panel>
    </section>
  );
}
