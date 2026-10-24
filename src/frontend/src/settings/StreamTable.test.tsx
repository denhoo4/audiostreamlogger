import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  getStreams: () => getStreams(),
  createStream: (body: StreamInput) => createStream(body),
  updateStream: (id: number, body: StreamInput) => updateStream(id, body),
  deleteStream: (id: number) => deleteStream(id),
  testStreamUrl: (url: string) => testStreamUrl(url),
}));

const ROWS: StreamRecord[] = [
  {
    id: 1,
    country: "NL",
    name: "Radio One",
    folder: "radio_one",
    url: "https://example.com/one",
    created_at: "2026-10-23 10:00:00",
    updated_at: "2026-10-23 10:00:00",
  },
  {
    id: 2,
    country: "BE",
    name: "Radio Two",
    folder: "radio_two",
    url: "https://example.com/two",
    created_at: "2026-10-23 10:00:00",
    updated_at: "2026-10-23 10:00:00",
  },
];

describe("StreamTable", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders one row per stream from getStreams()", async () => {
    getStreams.mockResolvedValue(ROWS);
    render(<StreamTable />);

    // Wait for the list to resolve.
    expect(await screen.findByText("Radio One")).toBeInTheDocument();
    const rows = document.querySelectorAll(".settings-table tbody tr");
    expect(rows.length).toBe(2);
    expect(screen.getByText("radio_one")).toBeInTheDocument();
    expect(screen.getByText("radio_two")).toBeInTheDocument();
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
