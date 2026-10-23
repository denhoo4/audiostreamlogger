import { useEffect, useState } from "react";
import { openJobStream, type JobRecord } from "../api";

/**
 * Map a job status to a badge CSS class. A job that was skipped because the
 * worker was busy ("skipped, busy") renders NEUTRAL, not as an error, so
 * operators do not misread the intended busy-skip semantic (design §6.3/§6.4).
 */
function badgeClass(job: JobRecord): string {
  if (job.status === "failed") return "job-badge job-badge-error";
  if (job.status === "done") return "job-badge job-badge-done";
  if (job.status === "running") return "job-badge job-badge-running";
  // pending + skipped (incl. "skipped, busy") are neutral.
  return "job-badge job-badge-neutral";
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

/**
 * Live job viewer (design §6.4). Opens an EventSource on /api/jobs/stream, keeps
 * the recent-jobs list in sync as snapshot/job events arrive, and renders each
 * job's status badge, trigger source, timestamps, and captured output. The
 * EventSource is closed on unmount.
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

  return (
    <section className="settings-section">
      <h2>Recent jobs</h2>
      {jobs.length === 0 ? (
        <p>No jobs yet.</p>
      ) : (
        <ul className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-item">
              <div className="job-header">
                <span className={badgeClass(job)}>{job.status}</span>
                <span className="job-type">{job.type}</span>
                <span className="job-trigger">{job.trigger_source}</span>
              </div>
              <div className="job-times">
                <span>created: {job.created_at}</span>
                <span>started: {job.started_at ?? "—"}</span>
                <span>finished: {job.finished_at ?? "—"}</span>
              </div>
              {job.output && <pre className="job-output">{job.output}</pre>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
