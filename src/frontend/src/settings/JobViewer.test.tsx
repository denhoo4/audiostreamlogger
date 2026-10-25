import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { cleanup, renderWithMantine, screen } from "../test/render-with-mantine";
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
    renderWithMantine(<JobViewer />);

    const src = FakeEventSource.last!;
    expect(src.url).toContain("/api/jobs/stream");

    act(() => {
      src.emit("snapshot", [
        makeJob({ id: 1, status: "skipped", output: "skipped, busy" }),
        makeJob({ id: 2, status: "done", type: "peakfilegenerator" }),
      ]);
    });

    // Two job rows render: one 'skipped' badge and one 'done' badge.
    const skipped = screen.getByText("skipped");
    const done = screen.getByText("done");
    expect(skipped).toBeInTheDocument();
    expect(done).toBeInTheDocument();

    // The skipped badge is NEUTRAL (gray), not the red/error variant. Mantine's
    // Badge drives its colour from the `--badge-bg`/`--badge-color` custom
    // properties (which reference the theme colour by name), so a neutral badge
    // must resolve to the gray theme colour and NEVER the red/error one.
    const skippedBadge = skipped.closest("[data-variant]") as HTMLElement;
    const doneBadge = done.closest("[data-variant]") as HTMLElement;
    expect(skippedBadge).not.toBeNull();
    const skippedBg = skippedBadge.style.getPropertyValue("--badge-bg");
    const doneBg = doneBadge.style.getPropertyValue("--badge-bg");
    expect(skippedBg).toContain("gray");
    expect(skippedBg).not.toContain("red");
    // Sanity: the neutral skipped badge differs from the green 'done' badge.
    expect(doneBg).toContain("green");
    expect(skippedBg).not.toBe(doneBg);

    // The 'skipped, busy' output text is present.
    expect(screen.getByText("skipped, busy")).toBeInTheDocument();
  });

  it("merges a changed job row delivered as a 'job' event", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    renderWithMantine(<JobViewer />);
    const src = FakeEventSource.last!;

    act(() => {
      src.emit("snapshot", [makeJob({ id: 1, status: "pending" })]);
    });
    act(() => {
      src.emit("job", makeJob({ id: 1, status: "running" }));
    });

    // The merge replaces by id: exactly one row, now showing status 'running'
    // (the previous 'pending' status is gone).
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByText("pending")).not.toBeInTheDocument();
  });

  it("closes the EventSource on unmount", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { unmount } = renderWithMantine(<JobViewer />);
    const src = FakeEventSource.last!;
    unmount();
    expect(src.closed).toBe(true);
  });
});
