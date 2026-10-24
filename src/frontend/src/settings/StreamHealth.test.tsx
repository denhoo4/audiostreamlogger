import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

const MIXED: StreamHealthResponse = {
  window_hours: 24,
  generated_slot: { date: "2026-10-23", hour: "12" },
  unhealthy_count: 3,
  counts: { total: 4, unhealthy: 3, ok: 1, degraded: 1, down: 1, never: 1 },
  streams: [
    {
      folder: "nl_ok",
      name: "NL OK",
      status: "ok",
      lastSuccessfulSlot: { date: "2026-10-23", hour: "11" },
      consecutiveMissing: 0,
      expectedInWindow: 24,
      presentInWindow: 24,
    },
    {
      folder: "nl_degraded",
      name: "NL Degraded",
      status: "degraded",
      lastSuccessfulSlot: { date: "2026-10-23", hour: "10" },
      consecutiveMissing: 2,
      expectedInWindow: 24,
      presentInWindow: 20,
    },
    {
      folder: "nl_down",
      name: "NL Down",
      status: "down",
      lastSuccessfulSlot: { date: "2026-10-22", hour: "08" },
      consecutiveMissing: 23,
      expectedInWindow: 24,
      presentInWindow: 0,
    },
    {
      folder: "nl_never",
      name: "NL Never",
      status: "never",
      lastSuccessfulSlot: null,
      consecutiveMissing: 0,
      expectedInWindow: 24,
      presentInWindow: 0,
    },
  ],
};

const ALL_OK: StreamHealthResponse = {
  window_hours: 24,
  generated_slot: { date: "2026-10-23", hour: "12" },
  unhealthy_count: 0,
  counts: { total: 3, unhealthy: 0, ok: 3, degraded: 0, down: 0, never: 0 },
  streams: [
    {
      folder: "a",
      name: "A",
      status: "ok",
      lastSuccessfulSlot: { date: "2026-10-23", hour: "11" },
      consecutiveMissing: 0,
      expectedInWindow: 24,
      presentInWindow: 24,
    },
    {
      folder: "b",
      name: "B",
      status: "ok",
      lastSuccessfulSlot: { date: "2026-10-23", hour: "11" },
      consecutiveMissing: 0,
      expectedInWindow: 24,
      presentInWindow: 24,
    },
    {
      folder: "c",
      name: "C",
      status: "ok",
      lastSuccessfulSlot: { date: "2026-10-23", hour: "11" },
      consecutiveMissing: 0,
      expectedInWindow: 24,
      presentInWindow: 24,
    },
  ],
};

describe("StreamHealth", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists problem streams first with their symptom", async () => {
    getStreamHealth.mockResolvedValue(MIXED);
    render(<StreamHealth />);

    // Wait for the panel to resolve.
    await screen.findByText("3 streams need attention (last 24h)");

    // Only the three non-ok streams render as problem rows, worst first:
    // down > degraded > never.
    const items = document.querySelectorAll(".stream-health-item");
    expect(items.length).toBe(3);
    const order = Array.from(items).map((el) =>
      el.className.replace("stream-health-item stream-health-item--", ""),
    );
    expect(order).toEqual(["down", "degraded", "never"]);

    // The down stream shows its status badge + consecutive-missing + last
    // successful hour formatted.
    expect(screen.getByText("down")).toBeInTheDocument();
    expect(
      screen.getByText(/23 missing hours, last success 2026-10-22 08:00/),
    ).toBeInTheDocument();

    // The degraded stream shows its trailing missing run.
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(
      screen.getByText(/2 missing hours, last success 2026-10-23 10:00/),
    ).toBeInTheDocument();

    // The never stream shows "no recordings yet" instead of a last-success time.
    expect(screen.getByText("never recorded")).toBeInTheDocument();
    expect(screen.getByText("no recordings yet")).toBeInTheDocument();

    // The healthy summary reflects the ok count.
    expect(screen.getByText("1 stream OK")).toBeInTheDocument();
  });

  it("renders no problem rows and an all-ok summary when every stream is ok", async () => {
    getStreamHealth.mockResolvedValue(ALL_OK);
    render(<StreamHealth />);

    await screen.findByText("All 3 streams OK");
    expect(document.querySelectorAll(".stream-health-item").length).toBe(0);
  });

  it("shows an error alert when the request fails", async () => {
    const { ApiError } = await import("../api");
    getStreamHealth.mockRejectedValue(new ApiError("boom", 500));
    render(<StreamHealth />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
    });
    expect(document.querySelectorAll(".stream-health-item").length).toBe(0);
  });
});
