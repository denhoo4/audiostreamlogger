import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { renderWithMantine } from "../test/render-with-mantine";
import StreamHealth from "./StreamHealth";
import type { StreamHealthResponse } from "../api";

// Mock the api.ts client so the component renders against fixed data without
// touching the network (mirrors RecordingsAnalysis.test.tsx / WorkerStatus).
const getStreamHealth = vi.fn<() => Promise<StreamHealthResponse>>();

vi.mock("../api", () => ({
  // ApiError is referenced by the component's catch-branch.
  ApiError: class ApiError extends Error {},
  getStreamHealth: () => getStreamHealth(),
}));

// A mix of recording-now / not-recording streams with varied 24h summaries.
const MIXED: StreamHealthResponse = {
  window_hours: 24,
  generated_slot: { date: "2026-10-23", hour: "12" },
  counts: { total: 3, recordingNow: 2, notRecording: 1 },
  streams: [
    {
      // Recording now, 24h complete.
      folder: "nl_now",
      name: "NL Now",
      recordingNow: true,
      last24h: { complete: true, gapCount: 0, gaps: [] },
      lastSlotStatus: "recording",
    },
    {
      // Recording now BUT has historical gaps — proves the gap count does not
      // drive the Now column.
      folder: "nl_gappy",
      name: "NL Gappy",
      recordingNow: true,
      last24h: {
        complete: false,
        gapCount: 3,
        gaps: [
          { date: "2026-10-23", hour: "02" },
          { date: "2026-10-23", hour: "05" },
          { date: "2026-10-23", hour: "06" },
        ],
      },
      lastSlotStatus: "recording",
    },
    {
      // Not recording now — must show the no-check marker regardless of its 24h
      // summary (which here is complete).
      folder: "nl_idle",
      name: "NL Idle",
      recordingNow: false,
      last24h: { complete: true, gapCount: 0, gaps: [] },
      lastSlotStatus: null,
    },
  ],
};

const ALL_RECORDING: StreamHealthResponse = {
  window_hours: 24,
  generated_slot: { date: "2026-10-23", hour: "12" },
  counts: { total: 3, recordingNow: 3, notRecording: 0 },
  streams: [
    {
      folder: "a",
      name: "A",
      recordingNow: true,
      last24h: { complete: true, gapCount: 0, gaps: [] },
      lastSlotStatus: "recording",
    },
    {
      folder: "b",
      name: "B",
      recordingNow: true,
      last24h: { complete: true, gapCount: 0, gaps: [] },
      lastSlotStatus: "recording",
    },
    {
      folder: "c",
      name: "C",
      recordingNow: true,
      last24h: { complete: true, gapCount: 0, gaps: [] },
      lastSlotStatus: "recording",
    },
  ],
};

describe("StreamHealth", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the two columns: a Now check and a 24h gap summary", async () => {
    getStreamHealth.mockResolvedValue(MIXED);
    renderWithMantine(<StreamHealth />);

    await screen.findByText("2/3 streams recording now (last 24h)");

    // Every stream renders a data row (header row excluded).
    const table = screen.getByRole("table");
    const bodyRows = within(table)
      .getAllByRole("row")
      .filter((r) => within(r).queryAllByRole("columnheader").length === 0);
    expect(bodyRows.length).toBe(3);

    // Two streams recording now → two green checks; one not → one red marker.
    expect(screen.getAllByLabelText("recording now").length).toBe(2);
    expect(screen.getAllByLabelText("not recording").length).toBe(1);

    // The gappy stream renders its gap-count + Amsterdam hour labels.
    expect(
      screen.getByText("3 gaps: 02:00, 05:00, 06:00"),
    ).toBeInTheDocument();

    // "complete" shows for streams with no gaps (nl_now + nl_idle).
    expect(screen.getAllByText("complete").length).toBe(2);
  });

  it("shows the no-check marker for a not-recording stream even when its 24h is complete", async () => {
    getStreamHealth.mockResolvedValue(MIXED);
    renderWithMantine(<StreamHealth />);

    await screen.findByText("2/3 streams recording now (last 24h)");

    // nl_idle is the not-recording stream; its row shows the "not recording"
    // marker and a "complete" 24h summary — so the Now column is independent
    // of the gap count.
    const idleName = screen.getByText("NL Idle");
    const idleRow = idleName.closest("tr");
    expect(idleRow).not.toBeNull();
    expect(
      idleRow?.querySelector('[aria-label="not recording"]'),
    ).not.toBeNull();
    expect(idleRow?.textContent).toContain("complete");
  });

  it("renders an all-recording header summary", async () => {
    getStreamHealth.mockResolvedValue(ALL_RECORDING);
    renderWithMantine(<StreamHealth />);

    await screen.findByText("3/3 streams recording now (last 24h)");
    expect(screen.getAllByLabelText("recording now").length).toBe(3);
    expect(screen.queryByLabelText("not recording")).toBeNull();
  });

  it("shows an error alert when the request fails", async () => {
    const { ApiError } = await import("../api");
    getStreamHealth.mockRejectedValue(new ApiError("boom", 500));
    renderWithMantine(<StreamHealth />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
    });
    // No table (and so no data rows) is rendered on error.
    expect(screen.queryByRole("table")).toBeNull();
  });
});
