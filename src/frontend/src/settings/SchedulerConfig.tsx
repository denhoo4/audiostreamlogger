import { useEffect, useState } from "react";
import {
  ApiError,
  getLogRetention,
  listSchedules,
  runJobNow,
  setLogRetention,
  updateSchedule,
  type ScheduleRecord,
} from "../api";

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
 * own Save (PUT /api/jobs/config/log_retention) sits below the schedule cards.
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
      <h2>Scheduled jobs</h2>

      {listError && (
        <p className="settings-error" role="alert">
          {listError}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : schedules.length === 0 ? (
        <p>No scheduled jobs.</p>
      ) : (
        schedules.map((s) => (
          <div key={s.type} className="settings-form">
            <h3>{s.type}</h3>
            <label>
              <input
                type="checkbox"
                checked={s.enabled === 1}
                onChange={(e) =>
                  patch(s.type, { enabled: e.target.checked ? 1 : 0 })
                }
              />
              Enabled
            </label>
            <label>
              Frequency
              <select
                value={s.frequency}
                onChange={(e) =>
                  patch(s.type, {
                    frequency: e.target.value as ScheduleRecord["frequency"],
                  })
                }
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>

            {s.frequency === "weekly" && (
              <label>
                Day of week
                <select
                  value={s.day_of_week}
                  onChange={(e) =>
                    patch(s.type, { day_of_week: Number(e.target.value) })
                  }
                >
                  {WEEKDAYS.map((label, idx) => (
                    <option key={label} value={idx}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(s.frequency === "daily" || s.frequency === "weekly") && (
              <label>
                Hour
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={s.hour}
                  onChange={(e) =>
                    patch(s.type, { hour: Number(e.target.value) })
                  }
                />
              </label>
            )}

            <label>
              Minute
              <input
                type="number"
                min={0}
                max={59}
                value={s.minute}
                onChange={(e) =>
                  patch(s.type, { minute: Number(e.target.value) })
                }
              />
            </label>

            {rowError[s.type] && (
              <p className="settings-error" role="alert">
                {rowError[s.type]}
              </p>
            )}
            {rowStatus[s.type] && <p>{rowStatus[s.type]}</p>}

            <div className="settings-form-actions">
              <button type="button" onClick={() => handleSave(s)}>
                Save
              </button>
              <button type="button" onClick={() => handleRunNow(s.type)}>
                Run now
              </button>
            </div>
          </div>
        ))
      )}

      <div className="settings-form">
        <h3>Log retention</h3>
        <label>
          Hours
          <input
            type="number"
            min={1}
            max={8760}
            value={retentionHours}
            onChange={(e) => setRetentionHours(e.target.value)}
          />
        </label>
        {retentionError && (
          <p className="settings-error" role="alert">
            {retentionError}
          </p>
        )}
        {retentionStatus && <p>{retentionStatus}</p>}
        <div className="settings-form-actions">
          <button type="button" onClick={handleSaveRetention}>
            Save
          </button>
        </div>
      </div>
    </section>
  );
}
