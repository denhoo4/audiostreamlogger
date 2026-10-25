import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { renderWithMantine } from "../test/render-with-mantine";
import RecordingsHealth from "./RecordingsHealth";
import type {
  AnalysisSummary,
  StorageEstimateResponse,
  StreamHealthResponse,
} from "../api";

// Mock the api.ts clients so the component renders against fixed data without
// touching the network (mirrors the former RecordingsAnalysis.test.tsx style).
const getAnalysisSummary = vi.fn<() => Promise<AnalysisSummary>>();
const getStreamHealth = vi.fn<() => Promise<StreamHealthResponse>>();
const getStorageEstimate = vi.fn<() => Promise<StorageEstimateResponse>>();

vi.mock("../api", () => ({
  // ApiError is referenced by the component's catch-branch.
  ApiError: class ApiError extends Error {},
  getAnalysisSummary: () => getAnalysisSummary(),
  getStreamHealth: () => getStreamHealth(),
  getStorageEstimate: () => getStorageEstimate(),
}));

const MiB = 1024 * 1024;

// Two streams present across all three endpoints, keyed by folder. radio_one
// is recording now + measured; radio_two is not recording + estimated.
const SUMMARY: AnalysisSummary = {
  per_stream: [
    {
      stream_folder: "radio_one",
      total_hours: 48,
      storage_bytes: 10 * MiB,
      recording_count: 48,
      avg_duration_seconds: 3600,
      earliest: "2026-10-20-00",
      latest: "2026-10-21-23",
    },
    {
      stream_folder: "radio_two",
      total_hours: 24,
      storage_bytes: 512 * 1024,
      recording_count: 24,
      avg_duration_seconds: null,
      earliest: "2026-10-22-00",
      latest: "2026-10-22-23",
    },
  ],
  overall: {
    total_hours: 72,
    storage_bytes: 10 * MiB + 512 * 1024,
    recording_count: 72,
    avg_duration_seconds: 3600,
    earliest: "2026-10-20-00",
    latest: "2026-10-22-23",
    stream_count: 2,
  },
};

const HEALTH: StreamHealthResponse = {
  window_hours: 24,
  generated_slot: { date: "2026-10-23", hour: "12" },
  counts: { total: 2, recordingNow: 1, notRecording: 1 },
  streams: [
    {
      folder: "radio_one",
      name: "Radio One",
      recordingNow: true,
      last24h: { complete: true, gapCount: 0, gaps: [] },
      lastSlotStatus: "recording",
    },
    {
      folder: "radio_two",
      name: "Radio Two",
      recordingNow: false,
      last24h: { complete: true, gapCount: 0, gaps: [] },
      lastSlotStatus: null,
    },
  ],
};

const STORAGE: StorageEstimateResponse = {
  retention_hours: 24,
  actual_bytes: 10 * MiB,
  projection: {
    retentionHours: 24,
    totalProjectedBytes: 72 * MiB,
    perStream: [
      {
        folder: "radio_one",
        name: "Radio One",
        bytesPerHour: 1 * MiB,
        source: "measured",
        projectedBytes: 24 * MiB,
      },
      {
        folder: "radio_two",
        name: "Radio Two",
        bytesPerHour: 2 * MiB,
        source: "estimated",
        projectedBytes: 48 * MiB,
      },
    ],
  },
};

function mockAll() {
  getAnalysisSummary.mockResolvedValue(SUMMARY);
  getStreamHealth.mockResolvedValue(HEALTH);
  getStorageEstimate.mockResolvedValue(STORAGE);
}

describe("RecordingsHealth", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders one merged data row per stream keyed by folder", async () => {
    mockAll();
    renderWithMantine(<RecordingsHealth />);

    // Wait for the merge to resolve (display names come from health/storage).
    await screen.findByText("Radio One");
    expect(screen.getByText("Radio Two")).toBeInTheDocument();

    const table = screen.getByRole("table");
    const bodyRows = within(table)
      .getAllByRole("row")
      .filter((r) => within(r).queryAllByRole("columnheader").length === 0);
    expect(bodyRows.length).toBe(2);

    // Each stream renders its name as the first cell of its row.
    const firstCells = bodyRows.map(
      (r) => within(r).getAllByRole("cell")[0].textContent,
    );
    expect(firstCells).toEqual(["Radio One", "Radio Two"]);
  });

  it("renders the Health column marker per stream with the same aria-labels", async () => {
    mockAll();
    renderWithMantine(<RecordingsHealth />);

    await screen.findByText("Radio One");

    // One recording-now check + one not-recording marker.
    expect(screen.getAllByLabelText("recording now").length).toBe(1);
    expect(screen.getAllByLabelText("not recording").length).toBe(1);

    // The not-recording marker is in radio_two's row.
    const twoRow = screen.getByText("Radio Two").closest("tr");
    expect(twoRow?.querySelector('[aria-label="not recording"]')).not.toBeNull();
  });

  it("renders the measured/estimated badge, bytes/hour and projected size cells", async () => {
    mockAll();
    renderWithMantine(<RecordingsHealth />);

    await screen.findByText("Radio One");

    // Source badges render by visible text.
    expect(screen.getByText("measured")).toBeInTheDocument();
    expect(screen.getByText("estimated")).toBeInTheDocument();

    // Bytes/hour cells (1 MiB/h and 2 MiB/h).
    expect(screen.getByText("1 MB/h")).toBeInTheDocument();
    expect(screen.getByText("2 MB/h")).toBeInTheDocument();

    // Per-stream projected sizes.
    expect(screen.getByText("24 MB")).toBeInTheDocument();
    expect(screen.getByText("48 MB")).toBeInTheDocument();
  });

  it("renders the two summary lines above the table", async () => {
    mockAll();
    renderWithMantine(<RecordingsHealth />);

    await screen.findByText("Radio One");

    // Projected total (72 MiB) over the 24h retention window.
    expect(screen.getByText(/Projected total:/)).toHaveTextContent(
      "72 MB",
    );
    expect(screen.getByText(/over 24h retention/)).toBeInTheDocument();
    // Currently on disk (10 MiB).
    expect(screen.getByText(/Currently on disk:/)).toHaveTextContent(
      "10 MB",
    );
  });

  it("degrades gracefully when a stream is missing from one source", async () => {
    // radio_two is absent from the storage estimate: its bytes/hour and
    // projected-size cells should fall back to an em dash.
    getAnalysisSummary.mockResolvedValue(SUMMARY);
    getStreamHealth.mockResolvedValue(HEALTH);
    getStorageEstimate.mockResolvedValue({
      ...STORAGE,
      projection: {
        ...STORAGE.projection,
        perStream: [STORAGE.projection.perStream[0]],
      },
    });
    renderWithMantine(<RecordingsHealth />);

    await screen.findByText("Radio Two");

    // radio_two keeps its name (from health) but has no estimate badge.
    const twoRow = screen.getByText("Radio Two").closest("tr");
    expect(twoRow?.textContent).toContain("—");
    expect(screen.queryByText("estimated")).toBeNull();
  });

  it("shows an error alert and no table when a request fails", async () => {
    const { ApiError } = await import("../api");
    getAnalysisSummary.mockRejectedValue(new ApiError("boom", 500));
    getStreamHealth.mockResolvedValue(HEALTH);
    getStorageEstimate.mockResolvedValue(STORAGE);
    renderWithMantine(<RecordingsHealth />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.queryByRole("table")).toBeNull();
  });
});
