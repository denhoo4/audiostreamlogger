import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import App, { pickInitialFolder } from "./App";
import type { Stream } from "./api";

// Records every URL the mocked WaveSurfer.load() was called with, so a test can
// assert the per-codec extension used for the player load.
const loadedUrls: string[] = [];

// Guard WaveSurfer so it never tries to decode real audio in jsdom. We stub the
// module with a minimal instance that records event handlers but does nothing.
vi.mock("wavesurfer.js", () => {
  class FakeWaveSurfer {
    static create() {
      return new FakeWaveSurfer();
    }
    registerPlugin<T>(p: T): T {
      return p;
    }
    on() {}
    load(url: string) {
      loadedUrls.push(url);
    }
    playPause() {}
    skip() {}
    seekTo() {}
    setTime() {}
    pause() {}
    getCurrentTime() {
      return 0;
    }
    getDuration() {
      return 0;
    }
    destroy() {}
  }
  return { default: FakeWaveSurfer };
});

vi.mock("wavesurfer.js/dist/plugins/regions.esm.js", () => {
  class FakeRegions {
    static create() {
      return new FakeRegions();
    }
    addRegion() {
      return { start: 0, end: 10, setOptions() {}, play() {} };
    }
    clearRegions() {}
  }
  return { default: FakeRegions };
});

describe("App smoke test", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Stub fetch: /api/settings -> [], /api/settings2 -> {}.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/app-config/public")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ title: "", default_stream_folder: "" }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            ),
          );
        }
        if (url.includes("/api/settings2")) {
          return Promise.resolve(
            new Response(JSON.stringify({}), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (url.includes("/api/settings")) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(new Response("", { status: 404 }));
      }),
    );
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders all controls against empty settings with no console errors", async () => {
    render(<App />);

    // Time display
    expect(document.getElementById("time-total")?.textContent).toBe(
      "0:00 / 0:00",
    );

    // Waveform container
    expect(document.getElementById("waveform")).toBeInTheDocument();

    // Transport buttons by label
    for (const label of ["-1m", "-10s", "-1s", "+1s", "+10s", "+1m"]) {
      expect(
        screen.getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    // Selection controls
    expect(document.getElementById("downloadbutton")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Selection Start" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Selection End" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Selection" }),
    ).toBeInTheDocument();
    expect(document.getElementById("playRegionButton")).toBeDisabled();
    expect(document.getElementById("downloadRegionButton")).toBeDisabled();

    // Selector row
    expect(document.getElementById("stringSelector")).toBeInTheDocument();
    expect(document.getElementById("dateSelector")).toBeInTheDocument();
    expect(document.getElementById("hourSelector")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inladen!" })).toBeInTheDocument();

    // Hidden wait message
    const wait = document.getElementById("downloadWait");
    expect(wait).toBeInTheDocument();
    expect(wait).toHaveStyle({ display: "none" });

    // Wait for the (empty) settings fetch to resolve.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    // No console.error during render / data load.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

const STREAM_ROWS: Stream[] = [
  {
    country: "NL",
    name: "Radio One",
    folder: "radio_one",
    url: "https://example.com/one",
    codec: "mp3",
  },
  {
    country: "BE",
    name: "Radio Two",
    folder: "radio_two",
    url: "https://example.com/two",
    codec: "mp3",
  },
];

/**
 * Stub fetch so /api/settings returns STREAM_ROWS, /api/settings2 returns {},
 * and /api/app-config/public returns the given default_stream_folder. This lets
 * the default-selection behaviour be exercised through a full App render.
 */
function stubFetchWithDefault(defaultFolder: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/app-config/public")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              title: "",
              default_stream_folder: defaultFolder,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/settings2")) {
        return Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          new Response(JSON.stringify(STREAM_ROWS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }),
  );
}

describe("App default-stream preselection (full render)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preselects the configured default_stream_folder when it matches a stream", async () => {
    stubFetchWithDefault("radio_two");
    render(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("radio_two");
    });
  });

  it("falls back to the first stream when the default is empty/unknown", async () => {
    stubFetchWithDefault("does_not_exist");
    render(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("radio_one");
    });
  });
});

const CODEC_STREAM_ROWS: Stream[] = [
  {
    country: "NL",
    name: "Opus Radio",
    folder: "opus_radio",
    url: "https://example.com/opus",
    codec: "opus",
  },
  {
    country: "BE",
    name: "Flac Radio",
    folder: "flac_radio",
    url: "https://example.com/flac",
    codec: "flac",
  },
];

/**
 * Stub fetch so /api/settings returns the per-codec streams, /api/settings2
 * returns {}, the public config is empty, and any /audio/*.json peaks request
 * 404s (so handleLoad falls back to ws.load(mediaUrl) without peaks).
 */
function stubFetchForCodecs() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/app-config/public")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ title: "", default_stream_folder: "" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/settings2")) {
        return Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          new Response(JSON.stringify(CODEC_STREAM_ROWS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      // Peaks JSON (or anything else): not found -> decode-from-media fallback.
      return Promise.resolve(new Response("", { status: 404 }));
    }),
  );
}

describe("App non-mp3 player load", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    loadedUrls.length = 0;
  });

  it.each([
    ["opus_radio", "opus"],
    ["flac_radio", "flac"],
  ])(
    "loads the %s recording via WaveSurfer using the .%s extension",
    async (folder, ext) => {
      stubFetchForCodecs();
      render(<App />);

      const selector = document.getElementById(
        "stringSelector",
      ) as HTMLSelectElement;
      await waitFor(() => {
        // First stream preselected once /api/settings resolves.
        expect(selector.value).toBe("opus_radio");
      });

      // Choose the target stream + a concrete date/hour.
      fireEvent.change(selector, { target: { value: folder } });
      fireEvent.change(
        document.getElementById("dateSelector") as HTMLInputElement,
        { target: { value: "2026-10-23" } },
      );
      // The hour selector only lists hours with a recording; set the value
      // directly via the underlying state by firing a change on the <select>
      // after injecting the option is unnecessary — handleLoad reads the hour
      // from component state, so drive it through the select's change event.
      const hourSelect = document.getElementById(
        "hourSelector",
      ) as HTMLSelectElement;
      // The option list is empty (settings2 is {}), so add one for the test.
      const opt = document.createElement("option");
      opt.value = "09";
      hourSelect.appendChild(opt);
      fireEvent.change(hourSelect, { target: { value: "09" } });

      fireEvent.click(screen.getByRole("button", { name: "Inladen!" }));

      await waitFor(() => {
        expect(
          loadedUrls.some((u) =>
            u.endsWith(`/audio/${folder}/${folder}-2026-10-23-09.${ext}`),
          ),
        ).toBe(true);
      });
    },
  );
});

describe("pickInitialFolder", () => {
  it("returns the default folder when it matches a loaded stream", () => {
    expect(pickInitialFolder(STREAM_ROWS, "radio_two")).toBe("radio_two");
  });

  it("falls back to the first stream for an unknown default", () => {
    expect(pickInitialFolder(STREAM_ROWS, "nope")).toBe("radio_one");
  });

  it("falls back to the first stream for an empty default", () => {
    expect(pickInitialFolder(STREAM_ROWS, "")).toBe("radio_one");
  });

  it("returns '' when there are no streams", () => {
    expect(pickInitialFolder([], "radio_one")).toBe("");
  });
});
