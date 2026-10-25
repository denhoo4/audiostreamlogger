import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  renderWithMantine,
  screen,
  waitFor,
  within,
} from "../test/render-with-mantine";
import StreamTable from "./StreamTable";
import type { StreamInput, StreamRecord } from "../api";

/**
 * StreamTable lists getStreams() and drives create/update/delete through the
 * api.ts clients, now with INLINE row editing (no bottom form). We mock those
 * clients so the table renders against fixed data and assert BEHAVIOUR: the
 * right api call + payload for create (via '+ New stream' with a DERIVED
 * folder), update (via the pencil, keeping the ORIGINAL folder), the typed-
 * confirm delete Modal, reorder, and the set-default star toggle. Assertions
 * target accessible names + api payloads, never class names.
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
// branch (which surfaces the backend message, e.g. a 409) is exercised.
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

/** Open the blank new-stream editor row via the '+ New stream' button. */
function openNewRow() {
  fireEvent.click(screen.getByRole("button", { name: "New stream" }));
}

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

    expect(await screen.findByText("Radio One")).toBeInTheDocument();
    expect(screen.getByText("Radio Two")).toBeInTheDocument();
    // The URL is shown in the read view.
    expect(screen.getByText("https://example.com/one")).toBeInTheDocument();
    // The Folder column is gone, so the folder string is NOT rendered.
    expect(screen.queryByText("radio_one")).not.toBeInTheDocument();
    expect(screen.queryByText("radio_two")).not.toBeInTheDocument();
  });

  it("renders a country-group header for each distinct country", async () => {
    getStreams.mockResolvedValue(ROWS);
    renderWithMantine(<StreamTable />);

    await screen.findByText("Radio One");
    const nl = screen.getByRole("columnheader", { name: "Netherlands" });
    const be = screen.getByRole("columnheader", { name: "Belgium" });
    expect(nl).toBeInTheDocument();
    expect(be).toBeInTheDocument();
    expect(
      nl.compareDocumentPosition(be) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("clicking a row's down arrow calls reorderStreams with the swapped id order", async () => {
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

  it("disables up on the first row and down on the last row of the flat order", async () => {
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

  it("clicking the star toggle calls setDefaultStream with that row's folder", async () => {
    getStreams.mockResolvedValue(ROWS);
    setDefaultStream.mockResolvedValue({ default_stream_folder: "radio_one" });
    renderWithMantine(<StreamTable />);

    await screen.findByText("Radio One");
    // Both rows start unfilled ("Set as default").
    const stars = screen.getAllByRole("button", { name: "Set as default" });
    fireEvent.click(stars[0]);

    await waitFor(() => {
      expect(setDefaultStream).toHaveBeenCalledWith("radio_one");
    });
    // The marked row now shows the filled-star "Default stream" control.
    expect(
      await screen.findByRole("button", { name: "Default stream" }),
    ).toBeInTheDocument();
  });

  it("marks the row whose folder matches default_stream_folder with a filled star", async () => {
    getStreams.mockResolvedValue(ROWS);
    getPublicConfig.mockResolvedValue({
      title: "",
      default_stream_folder: "radio_two",
    });
    renderWithMantine(<StreamTable />);

    await screen.findByText("Radio One");
    // Exactly one filled "Default stream" star; one unfilled "Set as default".
    expect(
      screen.getByRole("button", { name: "Default stream" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Set as default" }).length,
    ).toBe(1);
  });

  it("clicking a filled star clears the default via setDefaultStream('')", async () => {
    getStreams.mockResolvedValue(ROWS);
    getPublicConfig.mockResolvedValue({
      title: "",
      default_stream_folder: "radio_one",
    });
    setDefaultStream.mockResolvedValue({ default_stream_folder: "" });
    renderWithMantine(<StreamTable />);

    await screen.findByText("Radio One");
    fireEvent.click(screen.getByRole("button", { name: "Default stream" }));

    await waitFor(() => {
      expect(setDefaultStream).toHaveBeenCalledWith("");
    });
  });

  // --- CREATE via the inline '+ New stream' row ---------------------------

  it("'+ New stream' -> fill the inline row -> Save calls createStream with a DERIVED folder", async () => {
    getStreams.mockResolvedValue([]);
    createStream.mockResolvedValue(ROWS[0]);
    renderWithMantine(<StreamTable />);

    await screen.findByText("No streams yet.");
    openNewRow();

    // The blank editable row renders inside a "New stream" group.
    const newRowHeader = await screen.findByRole("columnheader", {
      name: "New stream",
    });
    expect(newRowHeader).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Country" }), {
      target: { value: "NL" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Radio One" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "https://example.com/one" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save new stream" }));

    await waitFor(() => {
      expect(createStream).toHaveBeenCalledTimes(1);
    });
    // Folder is DERIVED from the name ('Radio One' -> 'radio_one').
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

  it("a create whose derived folder collides is suffixed and a notice is shown", async () => {
    getStreams.mockResolvedValue(ROWS); // existing folder radio_one
    createStream.mockResolvedValue(ROWS[0]);
    renderWithMantine(<StreamTable />);

    await screen.findByText("Radio One");
    openNewRow();

    fireEvent.change(screen.getByRole("combobox", { name: "Country" }), {
      target: { value: "NL" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Radio One" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "https://example.com/dup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new stream" }));

    await waitFor(() => {
      expect(createStream).toHaveBeenCalledTimes(1);
    });
    expect(createStream).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "radio_one_2" }),
    );
    expect(await screen.findByText(/radio_one_2/)).toBeInTheDocument();
  });

  it("selecting flac in the new row shows bit-depth and hides bitrate; opus restores bitrate", async () => {
    getStreams.mockResolvedValue([]);
    renderWithMantine(<StreamTable />);
    await screen.findByText("No streams yet.");
    openNewRow();

    // Default codec mp3: Bitrate shown, no Bit depth.
    expect(
      screen.getByRole("combobox", { name: "Bitrate (kbps)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Bit depth" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Codec" }), {
      target: { value: "flac" },
    });
    expect(
      screen.getByRole("combobox", { name: "Bit depth" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Bitrate (kbps)" }),
    ).not.toBeInTheDocument();

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

  it("creating a flac stream sends a valid lossless combo (bit_depth set, bitrate null)", async () => {
    getStreams.mockResolvedValue([]);
    createStream.mockResolvedValue(ROWS[0]);
    renderWithMantine(<StreamTable />);
    await screen.findByText("No streams yet.");
    openNewRow();

    fireEvent.change(screen.getByRole("combobox", { name: "Country" }), {
      target: { value: "NL" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Radio Flac" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "https://example.com/flac" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Codec" }), {
      target: { value: "flac" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Bit depth" }), {
      target: { value: "24" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save new stream" }));

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

  it("Cancel discards the new row without calling createStream", async () => {
    getStreams.mockResolvedValue([]);
    renderWithMantine(<StreamTable />);
    await screen.findByText("No streams yet.");
    openNewRow();

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Throwaway" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "Name" }),
      ).not.toBeInTheDocument();
    });
    expect(createStream).not.toHaveBeenCalled();
  });

  // --- EDIT an existing row inline ----------------------------------------

  it("editing an existing stream's name calls updateStream with the ORIGINAL folder", async () => {
    getStreams.mockResolvedValue(ROWS);
    updateStream.mockResolvedValue(ROWS[0]);
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Edit Radio One" }));

    // The row is now editable in place; change the name.
    const nameInput = screen.getByRole("textbox", { name: "Name" });
    expect((nameInput as HTMLInputElement).value).toBe("Radio One");
    fireEvent.change(nameInput, { target: { value: "Radio One Renamed" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Radio One" }));

    await waitFor(() => {
      expect(updateStream).toHaveBeenCalledTimes(1);
    });
    // The folder is the ORIGINAL stored value, NOT re-derived from the new name.
    expect(updateStream).toHaveBeenCalledWith(1, {
      country: "NL",
      name: "Radio One Renamed",
      folder: "radio_one",
      url: "https://example.com/one",
      codec: "mp3",
      bitrate_kbps: 160,
      bit_depth: null,
    });
  });

  it("Cancel on an edit reverts without calling updateStream", async () => {
    getStreams.mockResolvedValue(ROWS);
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Edit Radio One" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "Name" }),
      ).not.toBeInTheDocument();
    });
    expect(updateStream).not.toHaveBeenCalled();
    // The original name is still shown.
    expect(screen.getByText("Radio One")).toBeInTheDocument();
  });

  it("a plain name edit does NOT show any folder-move warning", async () => {
    getStreams.mockResolvedValue(ROWS);
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Edit Radio One" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Radio One Renamed" },
    });

    // The old folder-move warning must never appear (there is no folder field).
    expect(
      screen.queryByText(/Changing the folder MOVES the existing recordings/),
    ).not.toBeInTheDocument();
  });

  it("surfaces a 409 from updateStream inline", async () => {
    getStreams.mockResolvedValue(ROWS);
    updateStream.mockRejectedValue(
      new MockApiError("stream is recording right now, try again next hour", 409),
    );
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Edit Radio One" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Radio One Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Radio One" }));

    expect(await screen.findByText(/recording right now/)).toBeInTheDocument();
  });

  // --- Inline URL Test ----------------------------------------------------

  it("clicking Test inside the editor calls testStreamUrl and shows 'Reachable'", async () => {
    getStreams.mockResolvedValue([]);
    testStreamUrl.mockResolvedValue({
      reachable: true,
      status: 200,
      contentType: "audio/mpeg",
      detail: "reachable audio stream",
    });
    renderWithMantine(<StreamTable />);
    await screen.findByText("No streams yet.");
    openNewRow();

    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
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
    openNewRow();

    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
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
    openNewRow();

    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
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

  // --- DELETE: typed-folder confirmation (unchanged behaviour) ------------

  it("Delete opens a typed-confirm panel showing the advisory file/byte count", async () => {
    getStreams.mockResolvedValue(ROWS);
    getDeletionImpact.mockResolvedValue({
      folder: "radio_one",
      fileCount: 3,
      totalBytes: 2048,
    });
    renderWithMantine(<StreamTable />);
    await screen.findByText("Radio One");

    fireEvent.click(screen.getByRole("button", { name: "Delete Radio One" }));

    await waitFor(() => {
      expect(getDeletionImpact).toHaveBeenCalledWith(1);
    });
    expect(await screen.findByText(/3 file\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
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

    const dialog = await screen.findByRole("dialog");
    const confirmBtn = within(dialog).getByRole("button", {
      name: "Confirm delete",
    });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByRole("textbox", {
      name: "Type folder name to confirm delete",
    });
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();
    expect(deleteStream).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "radio_one" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteStream).toHaveBeenCalledWith(1);
    });
  });

  it("Cancel aborts the delete: no deleteStream call and the panel closes", async () => {
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

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

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
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm delete" }),
    );

    expect(await screen.findByText(/recording right now/)).toBeInTheDocument();
  });
});
