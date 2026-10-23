import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import JobViewer from "./JobViewer";
import type { JobRecord } from "../api";

/**
 * Minimal EventSource stub: records named-event listeners so a test can push a
 * snapshot/job event, and a close() spy so we can assert teardown on unmount.
 */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  url: string;
  withCredentials: boolean;
  closed = false;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.last = this;
  }

  addEventListener(type: string, cb: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  emit(type: string, data: unknown) {
    const evt = { data: JSON.stringify(data) } as MessageEvent;
    for (const cb of this.listeners[type] ?? []) cb(evt);
  }

  close() {
    this.closed = true;
  }
}

function makeJob(overrides: Partial<JobRecord>): JobRecord {
  return {
    id: 1,
    type: "cleaner",
    trigger_source: "manual",
    status: "done",
    output: "",
    created_at: "2026-10-23 10:00:00",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe("JobViewer", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the snapshot list and a neutral badge for 'skipped, busy'", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    render(<JobViewer />);

    const src = FakeEventSource.last!;
    expect(src.url).toContain("/api/jobs/stream");

    act(() => {
      src.emit("snapshot", [
        makeJob({ id: 1, status: "skipped", output: "skipped, busy" }),
        makeJob({ id: 2, status: "done", type: "peakfilegenerator" }),
      ]);
    });

    const badges = document.querySelectorAll(".job-badge");
    expect(badges.length).toBe(2);
    // The skipped row must be neutral, not the error badge.
    const skipped = Array.from(badges).find(
      (b) => b.textContent === "skipped",
    )!;
    expect(skipped.classList.contains("job-badge-neutral")).toBe(true);
    expect(skipped.classList.contains("job-badge-error")).toBe(false);
    expect(screen.getByText("skipped, busy")).toBeInTheDocument();
  });

  it("merges a changed job row delivered as a 'job' event", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    render(<JobViewer />);
    const src = FakeEventSource.last!;

    act(() => {
      src.emit("snapshot", [makeJob({ id: 1, status: "pending" })]);
    });
    act(() => {
      src.emit("job", makeJob({ id: 1, status: "running" }));
    });

    const badges = document.querySelectorAll(".job-badge");
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("running");
  });

  it("closes the EventSource on unmount", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { unmount } = render(<JobViewer />);
    const src = FakeEventSource.last!;
    unmount();
    expect(src.closed).toBe(true);
  });
});
