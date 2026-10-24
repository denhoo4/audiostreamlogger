import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
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

const LIVE_STREAM_ROWS: Stream[] = [
  {
    country: "NL",
    name: "Live Radio",
    folder: "live_radio",
    url: "https://example.com/live",
    codec: "mp3",
  },
];

/**
 * Stub fetch so /api/settings returns a single mp3 stream, /api/settings2 and
 * the public config are empty, and the peaks JSON responds per `peaksOk`:
 * `true` -> 200 with a tiny peaks payload (ws.load gets peaks), `false` -> 404
 * (graceful decode-from-media fallback).
 */
function stubFetchForLive(peaksOk: boolean) {
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
          new Response(JSON.stringify(LIVE_STREAM_ROWS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes(".json")) {
        return peaksOk
          ? Promise.resolve(
              new Response(JSON.stringify({ data: [[0, 0]] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            )
          : Promise.resolve(new Response("", { status: 404 }));
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }),
  );
}

/**
 * Set the given date + inject/select the given hour option, then click
 * "Inladen!". Mirrors the per-codec test's hour-option injection (the option
 * list is empty because settings2 is {}). Assumes the stream is already
 * preselected (the caller settles the settings fetch first — with real timers
 * via waitFor, with fake timers via advanceTimersByTimeAsync).
 */
function loadHour(date: string, hour: string) {
  fireEvent.change(
    document.getElementById("dateSelector") as HTMLInputElement,
    { target: { value: date } },
  );
  const hourSelect = document.getElementById(
    "hourSelector",
  ) as HTMLSelectElement;
  const opt = document.createElement("option");
  opt.value = hour;
  hourSelect.appendChild(opt);
  fireEvent.change(hourSelect, { target: { value: hour } });
  fireEvent.click(screen.getByRole("button", { name: "Inladen!" }));
}

describe("App live-hour auto-refresh", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    loadedUrls.length = 0;
  });

  it("re-loads the LIVE hour with a cache-busted URL after the poll interval", async () => {
    vi.useFakeTimers();
    // 2026-07-15T08:30:00Z -> Amsterdam CEST 10:xx, so hour "10" on 2026-07-15
    // is the live slot.
    vi.setSystemTime(new Date("2026-07-15T08:30:00Z"));
    stubFetchForLive(true);
    render(<App />);

    // Settle the settings/preselect promise chain under fake timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    loadHour("2026-07-15", "10");
    // Flush the initial reload's fetch/load microtasks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      loadedUrls.some((u) =>
        u.endsWith("/audio/live_radio/live_radio-2026-07-15-10.mp3"),
      ),
    ).toBe(true);

    // Advance one poll tick; a cache-busted (?t=) reload must fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(
      loadedUrls.some((u) =>
        /\/audio\/live_radio\/live_radio-2026-07-15-10\.mp3\?t=\d+/.test(u),
      ),
    ).toBe(true);
  });

  it("clicking 'Ververs' triggers an immediate cache-busted reload", async () => {
    stubFetchForLive(true);
    render(<App />);

    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("live_radio");
    });

    // A PAST hour is fine here: the manual button reloads regardless of live-ness.
    loadHour("2020-01-01", "09");
    await waitFor(() => {
      expect(
        loadedUrls.some((u) =>
          u.endsWith("/audio/live_radio/live_radio-2020-01-01-09.mp3"),
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Ververs" }));
    await waitFor(() => {
      expect(
        loadedUrls.some((u) =>
          /\/audio\/live_radio\/live_radio-2020-01-01-09\.mp3\?t=\d+/.test(u),
        ),
      ).toBe(true);
    });
  });

  it("does NOT schedule a reload for a PAST hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:30:00Z"));
    stubFetchForLive(true);
    render(<App />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Load a clearly past hour (not the current Amsterdam slot).
    loadHour("2026-07-15", "05");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      loadedUrls.some((u) =>
        u.endsWith("/audio/live_radio/live_radio-2026-07-15-05.mp3"),
      ),
    ).toBe(true);
    const countAfterLoad = loadedUrls.length;

    // Advancing well past the poll interval must not re-load anything.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90000);
    });
    expect(loadedUrls.length).toBe(countAfterLoad);
  });

  it("falls back to ws.load(mediaUrl) when the peaks fetch fails (graceful missing peak)", async () => {
    stubFetchForLive(false);
    render(<App />);

    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("live_radio");
    });

    loadHour("2026-07-15", "10");
    await waitFor(() => {
      // mediaUrl was loaded even though the .json 404'd.
      expect(
        loadedUrls.some((u) =>
          u.endsWith("/audio/live_radio/live_radio-2026-07-15-10.mp3"),
        ),
      ).toBe(true);
    });
  });
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
