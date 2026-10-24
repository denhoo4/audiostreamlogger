import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import StorageEstimate from "./StorageEstimate";
import type { StorageEstimateResponse } from "../api";

// Mock the api.ts client so the component renders against fixed data without
// touching the network (mirrors StreamHealth.test.tsx / RecordingsAnalysis).
const getStorageEstimate = vi.fn<() => Promise<StorageEstimateResponse>>();

vi.mock("../api", () => ({
  // ApiError is referenced by the component's catch-branch.
  ApiError: class ApiError extends Error {},
  getStorageEstimate: () => getStorageEstimate(),
}));

// One measured stream + one estimated stream over a 24h retention window.
// Totals/bytes are chosen to produce clean 1024-based human-readable values:
//   measured: 1 MiB/h × 24h = 24 MiB projected
//   estimated: 2 MiB/h × 24h = 48 MiB projected
//   total: 72 MiB, actual on disk: 10 MiB
const MiB = 1024 * 1024;
const RESPONSE: StorageEstimateResponse = {
  retention_hours: 24,
  actual_bytes: 10 * MiB,
  projection: {
    retentionHours: 24,
    totalProjectedBytes: 72 * MiB,
    perStream: [
      {
        folder: "nl_measured",
        name: "NL Measured",
        bytesPerHour: 1 * MiB,
        source: "measured",
        projectedBytes: 24 * MiB,
      },
      {
        folder: "nl_estimated",
        name: "NL Estimated",
        bytesPerHour: 2 * MiB,
        source: "estimated",
        projectedBytes: 48 * MiB,
      },
    ],
  },
};

describe("StorageEstimate", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the projected total, retention window, and actual on-disk usage", async () => {
    getStorageEstimate.mockResolvedValue(RESPONSE);
    render(<StorageEstimate />);

    // Projected total (72 MiB) rendered in human-readable form over 24h.
    await screen.findByText("72 MB");
    expect(screen.getByText(/over 24h retention/)).toBeInTheDocument();
    // Actual on-disk total.
    expect(screen.getByText(/Currently on disk:/)).toHaveTextContent(
      "10 MB",
    );
  });

  it("renders one measured and one estimated row with the right badge", async () => {
    getStorageEstimate.mockResolvedValue(RESPONSE);
    render(<StorageEstimate />);

    await screen.findByText("NL Measured");
    expect(screen.getByText("NL Estimated")).toBeInTheDocument();

    // The measured/estimated source badges both render.
    const measuredBadge = screen.getByText("measured");
    const estimatedBadge = screen.getByText("estimated");
    expect(measuredBadge).toHaveClass("storage-estimate-badge-measured");
    expect(estimatedBadge).toHaveClass("storage-estimate-badge-estimated");

    // Per-stream projected sizes render.
    expect(screen.getByText("24 MB")).toBeInTheDocument();
    expect(screen.getByText("48 MB")).toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    const { ApiError } = await import("../api");
    getStorageEstimate.mockRejectedValue(new ApiError("boom", 500));
    render(<StorageEstimate />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // No table rendered on error.
    expect(document.querySelector(".analysis-table")).toBeNull();
  });
});
