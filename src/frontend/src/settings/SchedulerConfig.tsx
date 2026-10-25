import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import {
  ApiError,
  getLogRetention,
  listSchedules,
  runJobNow,
  setLogRetention,
  updateSchedule,
  type ScheduleRecord,
} from "../api";
import { AsyncState, Panel } from "../ui";

/** Weekday labels for the day-of-week select (0=Sunday..6=Saturday). */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const FREQUENCIES: ScheduleRecord["frequency"][] = [
  "hourly",
  "daily",
  "weekly",
];

/**
 * Per-type scheduler configuration (design §6.4). For each job type it renders
 * an enable toggle, a frequency select that conditionally shows the matching
 * anchor inputs (minute for hourly; hour+minute for daily; day-of-week +
 * hour+minute for weekly), a Save button (PUT /api/jobs/schedules/:type) and a
 * Run now button (POST /api/jobs {type}). A log_retention (hours) input with its
 * own Save (PUT /api/jobs/config/log_retention) renders inside the cleaner card,
 * between the Enabled toggle and the Frequency select.
 *
 * Restyled to the Mantine AI-Studio house style (Panel + Mantine
 * Switch/NativeSelect/NumberInput/Button); every api.ts call, the enabled 0|1
 * mapping, the conditional anchor fields, the inline status/error strings and
 * the <h2> heading are preserved verbatim — only presentation changed.
 */
export default function SchedulerConfig() {
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Per-type transient UI state (save/run errors + busy flags), keyed by type.
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  const [rowStatus, setRowStatus] = useState<Record<string, string | null>>({});

  const [retentionHours, setRetentionHours] = useState<string>("");
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionStatus, setRetentionStatus] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      setSchedules(await listSchedules());
    } catch (err) {
      setListError(
        err instanceof ApiError ? err.message : "Could not load schedules",
      );
    } finally {
      setLoading(false);
    }
  }

  async function refreshRetention() {
    try {
      const { hours } = await getLogRetention();
      setRetentionHours(hours === null ? "" : String(hours));
    } catch (err) {
      setRetentionError(
        err instanceof ApiError
          ? err.message
          : "Could not load log retention",
      );
    }
  }

  useEffect(() => {
    void refresh();
    void refreshRetention();
  }, []);

  function patch(type: string, changes: Partial<ScheduleRecord>) {
    setSchedules((prev) =>
      prev.map((s) => (s.type === type ? { ...s, ...changes } : s)),
    );
  }

  async function handleSave(schedule: ScheduleRecord) {
    setRowError({ ...rowError, [schedule.type]: null });
    setRowStatus({ ...rowStatus, [schedule.type]: "Saving…" });
    try {
      await updateSchedule(schedule.type, {
        enabled: schedule.enabled,
        frequency: schedule.frequency,
        minute: schedule.minute,
        hour: schedule.hour,
        day_of_week: schedule.day_of_week,
      });
      setRowStatus({ ...rowStatus, [schedule.type]: "Saved" });
      await refresh();
    } catch (err) {
      setRowStatus({ ...rowStatus, [schedule.type]: null });
      setRowError({
        ...rowError,
        [schedule.type]:
          err instanceof ApiError ? err.message : "Could not save schedule",
      });
    }
  }

  async function handleRunNow(type: ScheduleRecord["type"]) {
    setRowError({ ...rowError, [type]: null });
    setRowStatus({ ...rowStatus, [type]: "Enqueuing…" });
    try {
      await runJobNow(type);
      setRowStatus({ ...rowStatus, [type]: "Enqueued" });
    } catch (err) {
      setRowStatus({ ...rowStatus, [type]: null });
      setRowError({
        ...rowError,
        [type]: err instanceof ApiError ? err.message : "Could not run job",
      });
    }
  }

  async function handleSaveRetention() {
    setRetentionError(null);
    setRetentionStatus("Saving…");
    const hours = Number(retentionHours);
    try {
      const saved = await setLogRetention(hours);
      setRetentionHours(String(saved.hours));
      setRetentionStatus("Saved");
    } catch (err) {
      setRetentionStatus(null);
      setRetentionError(
        err instanceof ApiError
          ? err.message
          : "Could not save log retention",
      );
    }
  }

  return (
    <section className="settings-section">
      <Title order={2}>Scheduled jobs</Title>

      <Box mt="md">
        <AsyncState
          loading={loading}
          error={listError}
          empty={schedules.length === 0}
          emptyMessage="No scheduled jobs."
        >
          <Stack gap="md">
          {schedules.map((s) => (
            <Panel key={s.type}>
              <Stack gap="sm">
                <Title order={3}>{s.type}</Title>

                <Switch
                  label="Enabled"
                  checked={s.enabled === 1}
                  onChange={(e) =>
                    patch(s.type, {
                      enabled: e.currentTarget.checked ? 1 : 0,
                    })
                  }
                />

                {s.type === "cleaner" && (
                  <>
                    <NumberInput
                      label="Hours"
                      min={1}
                      max={8760}
                      value={
                        retentionHours === "" ? "" : Number(retentionHours)
                      }
                      onChange={(value) =>
                        setRetentionHours(value === "" ? "" : String(value))
                      }
                    />
                    {retentionError && (
                      <Alert color="red" role="alert">
                        {retentionError}
                      </Alert>
                    )}
                    {retentionStatus && <Text>{retentionStatus}</Text>}
                    <Group gap="sm">
                      <Button type="button" onClick={handleSaveRetention}>
                        Save
                      </Button>
                    </Group>
                  </>
                )}

                <NativeSelect
                  label="Frequency"
                  value={s.frequency}
                  onChange={(e) =>
                    patch(s.type, {
                      frequency: e.currentTarget
                        .value as ScheduleRecord["frequency"],
                    })
                  }
                  data={FREQUENCIES.map((f) => ({ value: f, label: f }))}
                />

                {s.frequency === "weekly" && (
                  <NativeSelect
                    label="Day of week"
                    value={s.day_of_week}
                    onChange={(e) =>
                      patch(s.type, {
                        day_of_week: Number(e.currentTarget.value),
                      })
                    }
                    data={WEEKDAYS.map((label, idx) => ({
                      value: String(idx),
                      label,
                    }))}
                  />
                )}

                {(s.frequency === "daily" || s.frequency === "weekly") && (
                  <NumberInput
                    label="Hour"
                    min={0}
                    max={23}
                    value={s.hour}
                    onChange={(value) =>
                      patch(s.type, { hour: Number(value) })
                    }
                  />
                )}

                <NumberInput
                  label="Minute"
                  min={0}
                  max={59}
                  value={s.minute}
                  onChange={(value) =>
                    patch(s.type, { minute: Number(value) })
                  }
                />

                {rowError[s.type] && (
                  <Alert color="red" role="alert">
                    {rowError[s.type]}
                  </Alert>
                )}
                {rowStatus[s.type] && <Text>{rowStatus[s.type]}</Text>}

                <Group gap="sm" wrap="wrap">
                  <Button type="button" onClick={() => handleSave(s)}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => handleRunNow(s.type)}
                  >
                    Run now
                  </Button>
                </Group>
              </Stack>
            </Panel>
          ))}
          </Stack>
        </AsyncState>
      </Box>
    </section>
  );
}
