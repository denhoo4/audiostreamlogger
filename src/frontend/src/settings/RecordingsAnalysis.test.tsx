import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import RecordingsAnalysis from "./RecordingsAnalysis";
import type { AnalysisGaps, AnalysisSummary } from "../api";

// Mock the api.ts clients so the component renders against fixed data without
// touching the network (mirrors the JobViewer.test.tsx mocking style).
const getAnalysisSummary = vi.fn<() => Promise<AnalysisSummary>>();
const getAnalysisGaps =
  vi.fn<(folder: string, start: string, end: string) => Promise<AnalysisGaps>>();

vi.mock("../api", () => ({
  // ApiError is referenced by the component's catch-branches.
  ApiError: class ApiError extends Error {},
  getAnalysisSummary: () => getAnalysisSummary(),
  getAnalysisGaps: (folder: string, start: string, end: string) =>
    getAnalysisGaps(folder, start, end),
}));

const SUMMARY: AnalysisSummary = {
  per_stream: [
    {
      stream_folder: "radio_one",
      total_hours: 48,
      storage_bytes: 1024 * 1024 * 10,
      recording_count: 48,
      avg_duration_seconds: 3600,
      earliest: "2026-10-20-00",
      latest: "2026-10-21-23",
    },
    {
      stream_folder: "radio_two",
      total_hours: 24,
      storage_bytes: 1024 * 512,
      recording_count: 24,
      avg_duration_seconds: null,
      earliest: "2026-10-22-00",
      latest: "2026-10-22-23",
    },
  ],
  overall: {
    total_hours: 72,
    storage_bytes: 1024 * 1024 * 10 + 1024 * 512,
    recording_count: 72,
    avg_duration_seconds: 3600,
    earliest: "2026-10-20-00",
    latest: "2026-10-22-23",
    stream_count: 2,
  },
};

describe("RecordingsAnalysis", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a per-stream row for each stream in the summary", async () => {
    getAnalysisSummary.mockResolvedValue(SUMMARY);
    render(<RecordingsAnalysis />);

    // Wait for the summary to resolve (storage cell is table-only).
    expect(await screen.findByText("10 MB")).toBeInTheDocument();

    // The table body has one row per stream.
    const rows = document.querySelectorAll(".analysis-table tbody tr");
    expect(rows.length).toBe(2);

    // Both folders appear as the first cell of their row.
    const firstCells = Array.from(rows).map(
      (r) => r.querySelector("td")?.textContent,
    );
    expect(firstCells).toEqual(["radio_one", "radio_two"]);

    // Human-readable storage for both streams.
    expect(screen.getByText("512 KB")).toBeInTheDocument();
  });

  it("renders the missing-slot list after submitting the gaps form", async () => {
    getAnalysisSummary.mockResolvedValue(SUMMARY);
    getAnalysisGaps.mockResolvedValue({
      folder: "radio_one",
      start: "2026-10-20",
      end: "2026-10-20",
      expected_count: 24,
      present_count: 22,
      missing: [
        { date: "2026-10-20", hour: "03" },
        { date: "2026-10-20", hour: "04" },
      ],
      coverage_ratio: 22 / 24,
    });

    render(<RecordingsAnalysis />);
    await screen.findByText("10 MB");

    fireEvent.submit(document.querySelector(".analysis-gaps-form")!);

    await waitFor(() => {
      expect(getAnalysisGaps).toHaveBeenCalledTimes(1);
    });

    // The two missing hour slots are listed.
    expect(await screen.findByText("Missing slots (2):")).toBeInTheDocument();
    const missing = document.querySelectorAll(".analysis-missing-list li");
    expect(missing.length).toBe(2);
    expect(screen.getByText("2026-10-20 03:00")).toBeInTheDocument();
    expect(screen.getByText("2026-10-20 04:00")).toBeInTheDocument();
  });
});
