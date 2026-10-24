import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import StreamTable from "./StreamTable";
import type { StreamInput, StreamRecord } from "../api";

/**
 * StreamTable lists getStreams() and drives create/update/delete through the
 * api.ts clients. We mock those clients (mirroring RecordingsAnalysis.test.tsx)
 * so the table renders against fixed data and one meaningful interaction — a
 * create submit — is asserted to call createStream with the entered fields.
 */
const getStreams = vi.fn<() => Promise<StreamRecord[]>>();
const createStream = vi.fn<(body: StreamInput) => Promise<StreamRecord>>();
const updateStream = vi.fn();
const deleteStream = vi.fn();
const testStreamUrl = vi.fn();
const reorderStreams = vi.fn();
const setDefaultStream = vi.fn();
const getPublicConfig =
  vi.fn<() => Promise<{ title: string; default_stream_folder: string }>>();

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  getStreams: () => getStreams(),
  createStream: (body: StreamInput) => createStream(body),
  updateStream: (id: number, body: StreamInput) => updateStream(id, body),
  deleteStream: (id: number) => deleteStream(id),
  testStreamUrl: (url: string) => testStreamUrl(url),
  reorderStreams: (order: number[]) => reorderStreams(order),
  setDefaultStream: (folder: string) => setDefaultStream(folder),
  getPublicConfig: () => getPublicConfig(),
}));

const ROWS: StreamRecord[] = [
  {
    id: 1,
    country: "NL",
    name: "Radio One",
    folder: "radio_one",
    url: "https://example.com/one",
    sort_order: 0,
    created_at: "2026-10-23 10:00:00",
    updated_at: "2026-10-23 10:00:00",
  },
  {
    id: 2,
    country: "BE",
    name: "Radio Two",
    folder: "radio_two",
    url: "https://example.com/two",
    sort_order: 1,
    created_at: "2026-10-23 10:00:00",
    updated_at: "2026-10-23 10:00:00",
  },
];

describe("StreamTable", () => {
  beforeEach(() => {
    // Default: no configured default stream. Individual tests override.
    getPublicConfig.mockResolvedValue({
      title: "",
      default_stream_folder: "",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders one data row per stream from getStreams()", async () => {
    getStreams.mockResolvedValue(ROWS);
    render(<StreamTable />);

    // Wait for the list to resolve.
    expect(await screen.findByText("Radio One")).toBeInTheDocument();
    // Data rows carry a folder cell; group-header rows do not.
    const dataRows = document.querySelectorAll(
      ".settings-table tbody tr:not(.settings-group-header)",
    );
    expect(dataRows.length).toBe(2);
    expect(screen.getByText("radio_one")).toBeInTheDocument();
    expect(screen.getByText("radio_two")).toBeInTheDocument();
  });

  it("renders a country-group header for each distinct country", async () => {
    getStreams.mockResolvedValue(ROWS);
    render(<StreamTable />);

    await screen.findByText("Radio One");
    const headers = Array.from(
      document.querySelectorAll(".settings-table tr.settings-group-header th"),
    ).map((th) => th.textContent);
    expect(headers).toEqual(["Netherlands", "Belgium"]);
  });

  it("clicking a row's ▼ calls reorderStreams with the swapped id order", async () => {
    getStreams.mockResolvedValue(ROWS);
    reorderStreams.mockResolvedValue({ ok: true });
    render(<StreamTable />);

    await screen.findByText("Radio One");
    // Move the first stream (id 1) down: order becomes [2, 1].
    fireEvent.click(screen.getByRole("button", { name: "Move Radio One down" }));

    await waitFor(() => {
      expect(reorderStreams).toHaveBeenCalledWith([2, 1]);
    });
  });

  it("disables ▲ on the first row and ▼ on the last row of the flat order", async () => {
    getStreams.mockResolvedValue(ROWS);
    render(<StreamTable />);

    await screen.findByText("Radio One");
    expect(
      screen.getByRole("button", { name: "Move Radio One up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Radio Two down" }),
    ).toBeDisabled();
  });

  it("clicking 'Set default' calls setDefaultStream with that row's folder", async () => {
    getStreams.mockResolvedValue(ROWS);
    setDefaultStream.mockResolvedValue({ default_stream_folder: "radio_one" });
    render(<StreamTable />);

    await screen.findByText("Radio One");
    const setButtons = screen.getAllByRole("button", { name: "Set default" });
    fireEvent.click(setButtons[0]);

    await waitFor(() => {
      expect(setDefaultStream).toHaveBeenCalledWith("radio_one");
    });
    // The marked row now shows the Default badge.
    expect(await screen.findByText("Default")).toBeInTheDocument();
  });

  it("marks the row whose folder matches default_stream_folder", async () => {
    getStreams.mockResolvedValue(ROWS);
    getPublicConfig.mockResolvedValue({
      title: "",
      default_stream_folder: "radio_two",
    });
    render(<StreamTable />);

    expect(await screen.findByText("Default")).toBeInTheDocument();
    // Only one 'Set default' button remains (for the non-default row).
    expect(screen.getAllByRole("button", { name: "Set default" }).length).toBe(
      1,
    );
  });

  it("submitting the add form calls createStream with the entered fields", async () => {
    getStreams.mockResolvedValue([]);
    createStream.mockResolvedValue(ROWS[0]);
    render(<StreamTable />);

    // Empty list placeholder confirms the initial load resolved.
    await screen.findByText("No streams yet.");

    // Fill the add form.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "NL" },
    });
    const textboxes = screen.getAllByRole("textbox");
    // Order in the form: Name, Folder, URL.
    fireEvent.change(textboxes[0], { target: { value: "Radio One" } });
    fireEvent.change(textboxes[1], { target: { value: "radio_one" } });
    fireEvent.change(textboxes[2], {
      target: { value: "https://example.com/one" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add stream" }));

    await waitFor(() => {
      expect(createStream).toHaveBeenCalledTimes(1);
    });
    expect(createStream).toHaveBeenCalledWith({
      country: "NL",
      name: "Radio One",
      folder: "radio_one",
      url: "https://example.com/one",
    });
  });

  it("clicking Test with a filled url calls testStreamUrl and shows 'Reachable'", async () => {
    getStreams.mockResolvedValue([]);
    testStreamUrl.mockResolvedValue({
      reachable: true,
      status: 200,
      contentType: "audio/mpeg",
      detail: "reachable audio stream",
    });
    render(<StreamTable />);
    await screen.findByText("No streams yet.");

    const textboxes = screen.getAllByRole("textbox");
    // Order in the form: Name, Folder, URL.
    fireEvent.change(textboxes[2], {
      target: { value: "https://example.com/one" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(testStreamUrl).toHaveBeenCalledWith("https://example.com/one");
    });
    expect(await screen.findByText(/Reachable/)).toBeInTheDocument();
  });

  it("shows 'Not reachable: <detail>' when the probe resolves reachable:false", async () => {
    getStreams.mockResolvedValue([]);
    testStreamUrl.mockResolvedValue({
      reachable: false,
      status: 404,
      detail: "server returned HTTP 404",
    });
    render(<StreamTable />);
    await screen.findByText("No streams yet.");

    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[2], {
      target: { value: "https://example.com/missing" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    expect(
      await screen.findByText(/Not reachable: server returned HTTP 404/),
    ).toBeInTheDocument();
  });

  it("the Test button is a non-submit button and does NOT call createStream", async () => {
    getStreams.mockResolvedValue([]);
    testStreamUrl.mockResolvedValue({
      reachable: true,
      status: 200,
      detail: "reachable audio stream",
    });
    render(<StreamTable />);
    await screen.findByText("No streams yet.");

    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[2], {
      target: { value: "https://example.com/one" },
    });

    const testButton = screen.getByRole("button", { name: "Test" });
    expect(testButton).toHaveAttribute("type", "button");

    fireEvent.click(testButton);

    await waitFor(() => {
      expect(testStreamUrl).toHaveBeenCalledTimes(1);
    });
    expect(createStream).not.toHaveBeenCalled();
  });
});
