import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  renderWithMantine,
  screen,
  waitFor,
} from "../test/render-with-mantine";
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
const getDeletionImpact = vi.fn();
const testStreamUrl = vi.fn();
const reorderStreams = vi.fn();
const setDefaultStream = vi.fn();
const getPublicConfig =
  vi.fn<() => Promise<{ title: string; default_stream_folder: string }>>();

// A minimal ApiError stand-in so the component's `err instanceof ApiError`
// branch (which surfaces the backend message, e.g. a 409) is exercised. Defined
// via vi.hoisted so it is available inside the hoisted vi.mock factory AND to
// the test bodies that throw it.
const { MockApiError } = vi.hoisted(() => ({
  MockApiError: class MockApiError extends Error {
    status: number;
    field?: string;
    constructor(message: string, status = 400, field?: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.field = field;
    }
  },
}));

vi.mock("../api", () => ({
  ApiError: MockApiError,
  getStreams: () => getStreams(),
  createStream: (body: StreamInput) => createStream(body),
  updateStream: (id: number, body: StreamInput) => updateStream(id, body),
  deleteStream: (id: number) => deleteStream(id),
  getDeletionImpact: (id: number) => getDeletionImpact(id),
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
    codec: "mp3",
    bitrate_kbps: 160,
    bit_depth: null,
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
    codec: "mp3",
    bitrate_kbps: 160,
    bit_depth: null,
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
    renderWithMantine(<StreamTable />);

    // Wait for the list to resolve.
    expect(await screen.findByText("Radio One")).toBeInTheDocument();
    // Behaviour: each stream's name and folder cell render (one data row each).
    expect(screen.getByText("Radio One")).toBeInTheDocument();
    expect(screen.getByText("Radio Two")).toBeInTheDocument();
    expect(screen.getByText("radio_one")).toBeInTheDocument();
    expect(screen.getByText("radio_two")).toBeInTheDocument();
  });

  it("renders a country-group header for each distinct country", async () => {
    getStreams.mockResolvedValue(ROWS);
    renderWithMantine(<StreamTable />);

    await screen.findByText("Radio One");
    // Behaviour: a country group header (a colgroup <th> → columnheader role)
    // renders for each distinct country, in document order. Querying by role
    // avoids matching the same names in the Country <select> options.
    const nl = screen.getByRole("columnheader", { name: "Netherlands" });
    const be = screen.getByRole("columnheader", { name: "Belgium" });
    expect(nl).toBeInTheDocument();
    expect(be).toBeInTheDocument();
    // Netherlands (NL, first stream) precedes Belgium (BE, second) in the DOM.
    expect(
      nl.compareDocumentPosition(be) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("clicking a row's ▼ calls reorderStreams with the swapped id order", async () => {
    getStreams.mockResolvedValue(ROWS);
    reorderStreams.mockResolvedValue({ ok: true });
    renderWithMantine(<StreamTable />);

    await screen.findByText("Radio One");
    // Move the first stream (id 1) down: order becomes [2, 1].
    fireEvent.click(screen.getByRole("button", { name: "Move Radio One down" }));

    await waitFor(() => {
      expect(reorderStreams).toHaveBeenCalledWith([2, 1]);
    });
  });

  it("disables ▲ on the first row and ▼ on the last row of the flat order", async () => {
    getStreams.mockResolvedValue(ROWS);
    renderWithMantine(<StreamTable />);

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
    renderWithMantine(<StreamTable />);

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
    renderWithMantine(<StreamTable />);

    expect(await screen.findByText("Default")).toBeInTheDocument();
    // Only one 'Set default' button remains (for the non-default row).
    expect(screen.getAllByRole("button", { name: "Set default" }).length).toBe(
      1,
    );
  });

  it("submitting the add form calls createStream with the entered fields", async () => {
    getStreams.mockResolvedValue([]);
    createStream.mockResolvedValue(ROWS[0]);
    renderWithMantine(<StreamTable />);

    // Empty list placeholder confirms the initial load resolved.
    await screen.findByText("No streams yet.");

    // Fill the add form. The country <select> is the combobox labelled Country.
    fireEvent.change(screen.getByRole("combobox", { name: "Country" }), {
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
    // Quality defaults to the behaviour-preserving mp3@160 combo.
    expect(createStream).toHaveBeenCalledWith({
      country: "NL",
      name: "Radio One",
      folder: "radio_one",
      url: "https://example.com/one",
      codec: "mp3",
      bitrate_kbps: 160,
      bit_depth: null,
    });
  });

  it("selecting flac shows a bit-depth control and hides bitrate; mp3/opus show bitrate", async () => {
    getStreams.mockResolvedValue([]);
    renderWithMantine(<StreamTable />);
    await screen.findByText("No streams yet.");

    // Default codec is mp3: a Bitrate control is shown, no Bit depth control.
    expect(
      screen.getByRole("combobox", { name: "Bitrate (kbps)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Bit depth" }),
    ).not.toBeInTheDocument();

    // Switch to flac: Bit depth appears, Bitrate disappears.
    fireEvent.change(screen.getByRole("combobox", { name: "Codec" }), {
      target: { value: "flac" },
    });
    expect(
      screen.getByRole("combobox", { name: "Bit depth" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Bitrate (kbps)" }),
    ).not.toBeInTheDocument();

    // Switch to opus (lossy): Bitrate is back, Bit depth hidden again.
    fireEvent.change(screen.getByRole("combobox", { name: "Codec" }), {
      target: { value: "opus" },
    });
    expect(
      screen.getByRole("combobox", { name: "Bitrate (kbps)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Bit depth" }),
    ).not.toBeInTheDocument();
  });

  it("submitting flac sends a valid lossless combo (bit_depth set, bitrate null)", async () => {
    getStreams.mockResolvedValue([]);
    createStream.mockResolvedValue(ROWS[0]);
    renderWithMantine(<StreamTable />);
    await screen.findByText("No streams yet.");

    fireEvent.change(screen.getByRole("combobox", { name: "Country" }), {
      target: { value: "NL" },
    });
    const textboxes = screen.getAllByRole("textbox");
    fireEvent.change(textboxes[0], { target: { value: "Radio Flac" } });
    fireEvent.change(textboxes[1], { target: { value: "radio_flac" } });
    fireEvent.change(textboxes[2], {
      target: { value: "https://example.com/flac" },
    });

    // Switching to flac resets to a valid lossless combo (bit_depth=16).
    fireEvent.change(screen.getByRole("combobox", { name: "Codec" }), {
      target: { value: "flac" },
    });
    // Pick the 24-bit option to confirm the control drives bit_depth.
    fireEvent.change(screen.getByRole("combobox", { name: "Bit depth" }), {
      target: { value: "24" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add stream" }));

    await waitFor(() => {
      expect(createStream).toHaveBeenCalledTimes(1);
    });
    expect(createStream).toHaveBeenCalledWith({
      country: "NL",
      name: "Radio Flac",
      folder: "radio_flac",
      url: "https://example.com/flac",
      codec: "flac",
      bitrate_kbps: null,
      bit_depth: 24,
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
    renderWithMantine(<StreamTable />);
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
    renderWithMantine(<StreamTable />);
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
    renderWithMantine(<StreamTable />);
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

  // --- DELETE: typed-folder confirmation (TODO item 25) -------------------

  it("Delete opens a typed-confirm panel showing the advisory file/byte count", async () => {
    getStreams.mockResolvedValue(ROWS);
    getDeletionImpact.mockResolvedValue({
      folder: "radio_one",
      fileCount: 3,
      totalBytes: 2048,
    });
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    // Click the first row's Delete button.
    fireEvent.click(screen.getByRole("button", { name: "Delete Radio One" }));

    await waitFor(() => {
      expect(getDeletionImpact).toHaveBeenCalledWith(1);
    });
    // Advisory count is shown.
    expect(await screen.findByText(/3 file\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    // Delete has NOT fired yet (still needs the typed confirm).
    expect(deleteStream).not.toHaveBeenCalled();
  });

  it("the delete confirm renders in a dialog with Confirm disabled on open", async () => {
    getStreams.mockResolvedValue(ROWS);
    getDeletionImpact.mockResolvedValue({
      folder: "radio_one",
      fileCount: 1,
      totalBytes: 10,
    });
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Delete Radio One" }));

    // The typed-confirm lives in a Modal dialog, and Confirm starts disabled.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm delete" }),
    ).toBeDisabled();
  });

  it("Confirm is disabled until the folder name is typed exactly; then it fires deleteStream", async () => {
    getStreams.mockResolvedValue(ROWS);
    getDeletionImpact.mockResolvedValue({
      folder: "radio_one",
      fileCount: 1,
      totalBytes: 10,
    });
    deleteStream.mockResolvedValue(undefined);
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Delete Radio One" }));
    await screen.findByText(/1 file\(s\)/);

    const confirmBtn = screen.getByRole("button", { name: "Confirm delete" });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByRole("textbox", {
      name: "Type folder name to confirm delete",
    });
    // A wrong value keeps it disabled.
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();
    expect(deleteStream).not.toHaveBeenCalled();

    // The exact folder name enables + fires the delete.
    fireEvent.change(input, { target: { value: "radio_one" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteStream).toHaveBeenCalledWith(1);
    });
  });

  it("Cancel aborts: no deleteStream call and the panel closes", async () => {
    getStreams.mockResolvedValue(ROWS);
    getDeletionImpact.mockResolvedValue({
      folder: "radio_one",
      fileCount: 1,
      totalBytes: 10,
    });
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Delete Radio One" }));
    await screen.findByText(/1 file\(s\)/);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Confirm delete" }),
      ).not.toBeInTheDocument();
    });
    expect(deleteStream).not.toHaveBeenCalled();
  });

  it("surfaces a 409 'recording right now' when the delete is refused", async () => {
    getStreams.mockResolvedValue(ROWS);
    getDeletionImpact.mockResolvedValue({
      folder: "radio_one",
      fileCount: 1,
      totalBytes: 10,
    });
    deleteStream.mockRejectedValue(
      new MockApiError("stream is recording right now, try again next hour", 409),
    );
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Delete Radio One" }));
    await screen.findByText(/1 file\(s\)/);
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Type folder name to confirm delete",
      }),
      { target: { value: "radio_one" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(
      await screen.findByText(/recording right now/),
    ).toBeInTheDocument();
  });

  // --- RENAME: edit-form warning + 409 handling (TODO item 26) ------------

  it("the edit form shows the folder-move warning; add mode does not", async () => {
    getStreams.mockResolvedValue(ROWS);
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    // Add mode: no warning.
    expect(
      screen.queryByText(/Changing the folder MOVES the existing recordings/),
    ).not.toBeInTheDocument();

    // Enter edit mode for the first row.
    fireEvent.click(screen.getByRole("button", { name: "Edit Radio One" }));
    expect(
      screen.getByText(/Changing the folder MOVES the existing recordings/),
    ).toBeInTheDocument();
  });

  it("surfaces a 409 from updateStream when a folder rename hits a recording hour", async () => {
    getStreams.mockResolvedValue(ROWS);
    updateStream.mockRejectedValue(
      new MockApiError("stream is recording right now, try again next hour", 409),
    );
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Edit Radio One" }));

    // Change the folder, then save.
    const folderInput = screen.getAllByRole("textbox")[1]; // Name, Folder, URL
    fireEvent.change(folderInput, { target: { value: "radio_renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText(/recording right now/),
    ).toBeInTheDocument();
  });
});
