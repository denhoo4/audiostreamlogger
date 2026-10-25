import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithMantine } from "./test/render-with-mantine";
import App, { pickInitialFolder } from "./App";
import type { Settings2, Stream } from "./api";

// Records every URL the mocked WaveSurfer.load() was called with, so a test can
// assert the per-codec extension used for the player load.
const loadedUrls: string[] = [];

// Handle to the single live fake WaveSurfer instance so tests can fire its
// captured lifecycle handlers ('ready'/'error') and transport spies. Reset in
// each suite's afterEach via resetFakeWs().
interface FakeWsHandle {
  handlers: Record<string, ((arg?: unknown) => void)[]>;
  emit: (event: string, arg?: unknown) => void;
  setTimeCalls: number[];
  playCalls: number;
  pauseCalls: number;
}
let fakeWs: FakeWsHandle | null = null;

function resetFakeWs() {
  fakeWs = null;
}

// Guard WaveSurfer so it never tries to decode real audio in jsdom. We stub the
// module with a minimal instance that records event handlers + transport calls
// so the loading-state and play-selection suites can drive and observe it.
vi.mock("wavesurfer.js", () => {
  class FakeWaveSurfer {
    handlers: Record<string, ((arg?: unknown) => void)[]> = {};
    setTimeCalls: number[] = [];
    playCalls = 0;
    pauseCalls = 0;
    static create() {
      const inst = new FakeWaveSurfer();
      fakeWs = {
        handlers: inst.handlers,
        emit: (event, arg) => {
          (inst.handlers[event] ?? []).forEach((h) => h(arg));
        },
        setTimeCalls: inst.setTimeCalls,
        get playCalls() {
          return inst.playCalls;
        },
        get pauseCalls() {
          return inst.pauseCalls;
        },
      } as FakeWsHandle;
      return inst;
    }
    registerPlugin<T>(p: T): T {
      return p;
    }
    on(event: string, handler: (arg?: unknown) => void) {
      (this.handlers[event] ??= []).push(handler);
    }
    load(url: string) {
      loadedUrls.push(url);
    }
    playPause() {}
    play() {
      this.playCalls += 1;
    }
    skip() {}
    seekTo() {}
    setTime(t: number) {
      this.setTimeCalls.push(t);
    }
    pause() {
      this.pauseCalls += 1;
    }
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

// The single region created by addRegion(); exposed so a play-selection test
// can read its start/end. Reset per suite.
let fakeRegion: { start: number; end: number } | null = null;

vi.mock("wavesurfer.js/dist/plugins/regions.esm.js", () => {
  class FakeRegions {
    static create() {
      return new FakeRegions();
    }
    addRegion(opts: { start: number; end: number }) {
      fakeRegion = {
        start: opts.start,
        end: opts.end,
        setOptions(o: { start: number; end: number }) {
          fakeRegion!.start = o.start;
          fakeRegion!.end = o.end;
        },
        play() {},
      } as unknown as { start: number; end: number };
      return fakeRegion;
    }
    clearRegions() {
      fakeRegion = null;
    }
  }
  return { default: FakeRegions };
});

/**
 * Drive the player's calendar (Mantine `DatePickerInput`, a popover trigger —
 * NOT a plain textbox) to the given `YYYY-MM-DD` day. Opens the dropdown with
 * the pointer-down+click sequence jsdom needs, waits for the calendar grid, then
 * clicks the day whose aria-label matches (Mantine's day controls carry an
 * "D MMMM YYYY" aria-label, e.g. "23 October 2026"). The day MUST be enabled —
 * only days present in the non-empty settings2 stub for the selected stream are
 * selectable, so the stub must contain the target day.
 */
async function pickDate(isoDate: string): Promise<void> {
  const [y, m, d] = isoDate.split("-");
  const asUtc = new Date(`${y}-${m}-${d}T00:00:00Z`);
  const monthName = asUtc.toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  // Mantine day controls carry a "D MMMM YYYY" aria-label (e.g. "15 July 2026")
  // and the header level button shows "MMMM YYYY" (e.g. "July 2026").
  const dayAriaLabel = `${Number(d)} ${monthName} ${y}`;
  const targetMonthLabel = `${monthName} ${y}`;
  const usingFakeTimers = vi.isFakeTimers();

  // Flush whichever timer the Popover's open transition runs on (fake timers for
  // the live-hour suite, real timers elsewhere), so neither path hangs.
  const flush = async () => {
    await act(async () => {
      if (usingFakeTimers) {
        await vi.advanceTimersByTimeAsync(50);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
  };

  const trigger = screen.getByLabelText("Date");
  // The pointer-down + click sequence is what opens the Mantine popover under
  // jsdom (a bare click does not flip aria-expanded).
  await act(async () => {
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
  });
  for (let i = 0; i < 20 && !document.querySelector("table"); i++) {
    await flush();
  }
  if (!document.querySelector("table")) {
    throw new Error("calendar did not open");
  }

  // The calendar opens on the current month. Navigate month-by-month until the
  // header level label matches the target month, so any day (past or present)
  // is reachable without depending on where "today" lands.
  const levelLabel = () =>
    (
      Array.from(document.querySelectorAll("button")).find(
        (b) =>
          !b.hasAttribute("data-direction") &&
          /^[A-Z][a-z]+ \d{4}$/.test(b.textContent ?? ""),
      )?.textContent ?? ""
    ).trim();
  const clickDirection = async (direction: "previous" | "next") => {
    const btn = document.querySelector(
      `button[data-direction="${direction}"]`,
    ) as HTMLButtonElement | null;
    if (!btn) throw new Error(`no ${direction} control`);
    await act(async () => {
      fireEvent.click(btn);
    });
  };
  const monthIndex = (label: string) => {
    const [name, year] = label.split(" ");
    const mi = new Date(`${name} 1, ${year} UTC`).getUTCMonth();
    return Number(year) * 12 + mi;
  };
  const targetIndex = monthIndex(targetMonthLabel);
  for (let i = 0; i < 360 && levelLabel() !== targetMonthLabel; i++) {
    const current = levelLabel();
    if (!current) break;
    await clickDirection(monthIndex(current) > targetIndex ? "previous" : "next");
  }
  if (levelLabel() !== targetMonthLabel) {
    throw new Error(`could not navigate to ${targetMonthLabel}`);
  }

  const dayButton = Array.from(
    document.querySelectorAll("table button"),
  ).find((b) => b.getAttribute("aria-label") === dayAriaLabel) as
    | HTMLButtonElement
    | undefined;
  if (!dayButton) throw new Error(`day control not found: ${dayAriaLabel}`);
  await act(async () => {
    fireEvent.click(dayButton);
  });
}

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
    renderWithMantine(<App />);

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
    // The play/pause button is icon-only; it is found by its aria-label
    // ("Play" when paused).
    expect(
      screen.getByRole("button", { name: "Play" }),
    ).toBeInTheDocument();

    // Selection controls
    expect(document.getElementById("downloadbutton")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Selection start" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Selection end" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear selection" }),
    ).toBeInTheDocument();
    expect(document.getElementById("playRegionButton")).toBeDisabled();
    expect(document.getElementById("downloadRegionButton")).toBeDisabled();

    // Selector row
    expect(document.getElementById("stringSelector")).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(document.getElementById("hourSelector")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument();

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
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("radio_two");
    });
  });

  it("falls back to the first stream of the COUNTRY-ORDERED list when the default is empty/unknown", async () => {
    stubFetchWithDefault("does_not_exist");
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    // country_order is absent -> alphabetical-by-name fallback puts Belgium
    // (radio_two) before Netherlands (radio_one), so the first ordered stream
    // is radio_two.
    await waitFor(() => {
      expect(selector.value).toBe("radio_two");
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

// Non-empty settings2 stub keyed by the stored station NAME verbatim (station ->
// year -> month -> day -> hours[]), so the calendar has a selectable day and the
// hour selector has an option for each per-codec stream. Both streams expose
// 2026-10-23 at hour 09.
const CODEC_TREE: Settings2 = {
  "Opus Radio": {
    "2026": { "10": { "23": ["09"] } },
  } as unknown as Settings2[string],
  "Flac Radio": {
    "2026": { "10": { "23": ["09"] } },
  } as unknown as Settings2[string],
};

/**
 * Stub fetch so /api/settings returns the per-codec streams, /api/settings2
 * returns the NON-EMPTY CODEC_TREE (so the calendar day + hour option exist),
 * the public config is empty, and any /audio/*.json peaks request 404s (so
 * handleLoad falls back to ws.load(mediaUrl) without peaks).
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
          new Response(JSON.stringify(CODEC_TREE), {
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
      renderWithMantine(<App />);

      const selector = document.getElementById(
        "stringSelector",
      ) as HTMLSelectElement;
      await waitFor(() => {
        // First stream of the COUNTRY-ORDERED list preselected once
        // /api/settings resolves. country_order is absent -> alphabetical by
        // name, so Belgium (flac_radio) precedes Netherlands (opus_radio).
        expect(selector.value).toBe("flac_radio");
      });

      // Choose the target stream (changing the stream clears any date/hour),
      // then pick the day via the calendar and the hour via the native select.
      fireEvent.change(selector, { target: { value: folder } });
      await pickDate("2026-10-23");
      const hourSelect = document.getElementById(
        "hourSelector",
      ) as HTMLSelectElement;
      // The hour option list is derived from the non-empty settings2 stub, so
      // "09" is already present for this stream + day.
      fireEvent.change(hourSelect, { target: { value: "09" } });

      fireEvent.click(screen.getByRole("button", { name: "Load" }));

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

// Non-empty settings2 stub for the single live stream. Exposes every day the
// live-hour suite drives (the live slot 2026-07-15, the past 2020-01-01) so the
// calendar has those days selectable and the hour selector offers 05/09/10.
const LIVE_TREE: Settings2 = {
  "Live Radio": {
    "2026": { "07": { "15": ["05", "10"] } },
    "2020": { "01": { "01": ["09"] } },
  } as unknown as Settings2[string],
};

/**
 * Stub fetch so /api/settings returns a single mp3 stream, /api/settings2
 * returns the NON-EMPTY LIVE_TREE (selectable days + hour options), the public
 * config is empty, and the peaks JSON responds per `peaksOk`: `true` -> 200 with
 * a tiny peaks payload (ws.load gets peaks), `false` -> 404 (graceful
 * decode-from-media fallback).
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
          new Response(JSON.stringify(LIVE_TREE), {
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
 * Pick the given date via the calendar + set the given hour via the native
 * select, then click "Load". The stream is already preselected (the caller
 * settles the settings fetch first). The day + hour must exist in LIVE_TREE for
 * them to be selectable.
 */
async function loadHour(date: string, hour: string) {
  await pickDate(date);
  const hourSelect = document.getElementById(
    "hourSelector",
  ) as HTMLSelectElement;
  fireEvent.change(hourSelect, { target: { value: hour } });
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
}

describe("App live-hour auto-refresh", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    loadedUrls.length = 0;
  });

  it("loads the LIVE hour client-side with a cache-busted URL and NO peaks fetch, then re-loads on each poll tick", async () => {
    vi.useFakeTimers();
    // 2026-07-15T08:30:00Z -> Amsterdam CEST 10:xx, so hour "10" on 2026-07-15
    // is the live slot.
    vi.setSystemTime(new Date("2026-07-15T08:30:00Z"));
    stubFetchForLive(true);
    renderWithMantine(<App />);

    // Settle the settings/preselect promise chain under fake timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await loadHour("2026-07-15", "10");
    // Flush the initial reload's fetch/load microtasks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // The LIVE branch always cache-busts and decodes client-side, so the very
    // first Load already carries a ?t= and the mp3 is the only thing loaded.
    expect(
      loadedUrls.some((u) =>
        /\/audio\/live_radio\/live_radio-2026-07-15-10\.mp3\?t=\d+/.test(u),
      ),
    ).toBe(true);
    // The live hour is decoded from the mp3: the .json peaks file is never
    // fetched.
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        ([input]) => String(input).includes(".json"),
      ),
    ).toBe(false);

    // Advance one poll tick; another cache-busted (?t=) reload must fire.
    const countBeforeTick = loadedUrls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(loadedUrls.length).toBeGreaterThan(countBeforeTick);
    expect(
      loadedUrls.every((u) =>
        /\/audio\/live_radio\/live_radio-2026-07-15-10\.mp3\?t=\d+/.test(u),
      ),
    ).toBe(true);
  });

  it("fetches the .json peaks for a PAST hour and passes them to WaveSurfer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:30:00Z"));
    stubFetchForLive(true);
    renderWithMantine(<App />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // A clearly PAST hour: the .json peaks are fetched and used.
    await loadHour("2020-01-01", "09");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      loadedUrls.some((u) =>
        u.endsWith("/audio/live_radio/live_radio-2020-01-01-09.mp3"),
      ),
    ).toBe(true);
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        ([input]) =>
          String(input).includes(
            "/audio/live_radio/live_radio-2020-01-01-09.json",
          ),
      ),
    ).toBe(true);
  });

  it("does NOT schedule a reload for a PAST hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:30:00Z"));
    stubFetchForLive(true);
    renderWithMantine(<App />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Load a clearly past hour (not the current Amsterdam slot).
    await loadHour("2026-07-15", "05");
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
    renderWithMantine(<App />);

    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("live_radio");
    });

    await loadHour("2026-07-15", "10");
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

// --- Stream-change: preserve date/hour when valid for the new stream -------

const PRESERVE_STREAM_ROWS: Stream[] = [
  {
    country: "NL",
    name: "Alpha Radio",
    folder: "alpha_radio",
    url: "https://example.com/alpha",
    codec: "mp3",
  },
  {
    country: "NL",
    name: "Bravo Radio",
    folder: "bravo_radio",
    url: "https://example.com/bravo",
    codec: "mp3",
  },
];

/**
 * Build a settings2 stub for the two preserve-streams. Alpha always has
 * 2026-10-23 @ 09 + 10. Bravo's slots vary per case so the keep-vs-clear rule
 * can be exercised:
 *   - "shared":   Bravo has 2026-10-23 @ 09 (keep both date + hour)
 *   - "no-day":   Bravo has only 2026-11-01 (clear date + hour)
 *   - "no-hour":  Bravo has 2026-10-23 @ 15 (keep date, clear hour)
 */
function preserveTree(kind: "shared" | "no-day" | "no-hour"): Settings2 {
  const bravo =
    kind === "shared"
      ? { "2026": { "10": { "23": ["09"] } } }
      : kind === "no-day"
        ? { "2026": { "11": { "01": ["09"] } } }
        : { "2026": { "10": { "23": ["15"] } } };
  return {
    "Alpha Radio": {
      "2026": { "10": { "23": ["09", "10"] } },
    } as unknown as Settings2[string],
    "Bravo Radio": bravo as unknown as Settings2[string],
  };
}

function stubFetchForPreserve(kind: "shared" | "no-day" | "no-hour") {
  const tree = preserveTree(kind);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/app-config/public")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ title: "", default_stream_folder: "alpha_radio" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.includes("/api/settings2")) {
        return Promise.resolve(
          new Response(JSON.stringify(tree), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/settings")) {
        return Promise.resolve(
          new Response(JSON.stringify(PRESERVE_STREAM_ROWS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }),
  );
}

describe("App stream-change date/hour preservation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    loadedUrls.length = 0;
    resetFakeWs();
    fakeRegion = null;
  });

  async function setupAlphaSelection(
    kind: "shared" | "no-day" | "no-hour",
  ): Promise<HTMLSelectElement> {
    stubFetchForPreserve(kind);
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("alpha_radio");
    });
    // Pick Alpha's shared day + hour 09.
    await pickDate("2026-10-23");
    const hourSelect = document.getElementById(
      "hourSelector",
    ) as HTMLSelectElement;
    fireEvent.change(hourSelect, { target: { value: "09" } });
    // The DatePickerInput trigger shows the formatted value (not the
    // placeholder) once a day is chosen; the hour native-select holds "09".
    expect(dateSelectionText()).not.toBe("Pick a day");
    expect(hourSelect.value).toBe("09");
    return selector;
  }

  // Text shown on the DatePickerInput trigger: the formatted date when a day is
  // selected, or the "Pick a day" placeholder when it is cleared. Read from the
  // labelled trigger element.
  function dateSelectionText(): string {
    return (screen.getByLabelText("Date").textContent ?? "").trim();
  }

  it("keeps date + hour when the new stream also has that exact day + hour", async () => {
    const selector = await setupAlphaSelection("shared");
    const hourSelect = document.getElementById(
      "hourSelector",
    ) as HTMLSelectElement;
    const keptDate = dateSelectionText();

    fireEvent.change(selector, { target: { value: "bravo_radio" } });

    await waitFor(() => {
      expect(selector.value).toBe("bravo_radio");
    });
    // Both preserved: the shared day + hour survive the switch.
    expect(dateSelectionText()).toBe(keptDate);
    expect(hourSelect.value).toBe("09");
  });

  it("clears date + hour when the new stream lacks that day", async () => {
    const selector = await setupAlphaSelection("no-day");
    const hourSelect = document.getElementById(
      "hourSelector",
    ) as HTMLSelectElement;

    fireEvent.change(selector, { target: { value: "bravo_radio" } });

    await waitFor(() => {
      expect(selector.value).toBe("bravo_radio");
    });
    expect(dateSelectionText()).toBe("Pick a day");
    expect(hourSelect.value).toBe("");
  });

  it("keeps the date but clears the hour when the new stream has the day but not the hour", async () => {
    const selector = await setupAlphaSelection("no-hour");
    const hourSelect = document.getElementById(
      "hourSelector",
    ) as HTMLSelectElement;
    const keptDate = dateSelectionText();

    fireEvent.change(selector, { target: { value: "bravo_radio" } });

    await waitFor(() => {
      expect(selector.value).toBe("bravo_radio");
    });
    expect(dateSelectionText()).toBe(keptDate);
    expect(dateSelectionText()).not.toBe("Pick a day");
    expect(hourSelect.value).toBe("");
  });
});

// --- Loading feedback over the waveform during a load ----------------------

describe("App loading feedback", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    loadedUrls.length = 0;
    resetFakeWs();
    fakeRegion = null;
  });

  it("shows a loading state after Load and clears it on the WaveSurfer 'ready' event", async () => {
    stubFetchForLive(false);
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("live_radio");
    });

    await loadHour("2026-07-15", "10");
    // The load() set isLoading=true: the time placeholder shows and the
    // numeric readout is gone.
    await waitFor(() => {
      expect(screen.getByTestId("time-loading")).toBeInTheDocument();
    });
    expect(document.getElementById("time-total")).not.toBeInTheDocument();

    // Fire WaveSurfer 'ready': loading clears and the time readout returns.
    await act(async () => {
      fakeWs?.emit("ready", 120);
    });
    await waitFor(() => {
      expect(document.getElementById("time-total")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("time-loading")).not.toBeInTheDocument();
    expect(document.getElementById("waveform-error")).not.toBeInTheDocument();
  });

  it("clears loading and shows an error message on the WaveSurfer 'error' event", async () => {
    stubFetchForLive(false);
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("live_radio");
    });

    await loadHour("2026-07-15", "10");
    await waitFor(() => {
      expect(screen.getByTestId("time-loading")).toBeInTheDocument();
    });

    await act(async () => {
      fakeWs?.emit("error", new Error("decode failed"));
    });
    await waitFor(() => {
      expect(document.getElementById("waveform-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("time-loading")).not.toBeInTheDocument();
  });
});

// --- Play selection stops exactly at the region end ------------------------

describe("App play-selection stops at region end", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    loadedUrls.length = 0;
    resetFakeWs();
    fakeRegion = null;
  });

  it("seeks to the region start, plays, and auto-pauses only when the end is reached", async () => {
    stubFetchForLive(false);
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("live_radio");
    });
    await loadHour("2026-07-15", "10");
    await act(async () => {
      fakeWs?.emit("ready", 120);
    });

    // Create a selection (Selection start makes { start: t, end: t+10 } with
    // t = currentTime = 0 under the fake).
    fireEvent.click(screen.getByRole("button", { name: "Selection start" }));
    expect(fakeRegion).not.toBeNull();
    const regionEnd = fakeRegion!.end;

    const playsBefore = fakeWs!.playCalls;
    const pausesBefore = fakeWs!.pauseCalls;

    fireEvent.click(screen.getByRole("button", { name: "Play selection" }));
    // Seeked to the region start and started playing.
    expect(fakeWs!.setTimeCalls[fakeWs!.setTimeCalls.length - 1]).toBe(
      fakeRegion!.start,
    );
    expect(fakeWs!.playCalls).toBe(playsBefore + 1);

    // A timeupdate before the end does NOT pause.
    await act(async () => {
      fakeWs?.emit("timeupdate", regionEnd - 1);
    });
    expect(fakeWs!.pauseCalls).toBe(pausesBefore);

    // A timeupdate at the end pauses exactly once.
    await act(async () => {
      fakeWs?.emit("timeupdate", regionEnd);
    });
    expect(fakeWs!.pauseCalls).toBe(pausesBefore + 1);

    // A later timeupdate does NOT pause again (guard cleared).
    await act(async () => {
      fakeWs?.emit("timeupdate", regionEnd + 5);
    });
    expect(fakeWs!.pauseCalls).toBe(pausesBefore + 1);
  });
});

// --- Play/pause control is keyboard-reachable by its accessible name -------

describe("App play/pause control accessible name", () => {
  beforeEach(() => {
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
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(new Response("", { status: 404 }));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetFakeWs();
  });

  it("exposes the icon-only transport control as 'Play', flipping to 'Pause' once playing", async () => {
    renderWithMantine(<App />);

    // The icon-only ActionIcon is reachable purely by its accessible name
    // (aria-label) — 'Play' while paused.
    const control = screen.getByRole("button", { name: "Play" });
    expect(control).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();

    // The WaveSurfer 'play' event drives isPlaying, flipping the aria-label to
    // 'Pause' so the same control keeps a correct accessible name.
    await act(async () => {
      fakeWs?.emit("play");
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });
});

// --- Stream picker groups stations by country with optgroup headers --------

// Streams spanning three countries, deliberately NOT in country_order so the
// grouping/ordering is actually exercised. BE + NL are listed in country_order
// (BE first), FR is unlisted so it falls last (alphabetical by name among the
// rest). Within NL the two stations keep their input order.
const GROUP_STREAM_ROWS: Stream[] = [
  {
    country: "FR",
    name: "Radio Six",
    folder: "radio_six",
    url: "https://example.com/six",
    codec: "mp3",
  },
  {
    country: "NL",
    name: "Radio One",
    folder: "radio_one",
    url: "https://example.com/one",
    codec: "mp3",
  },
  {
    country: "BE",
    name: "Radio Four",
    folder: "radio_four",
    url: "https://example.com/four",
    codec: "mp3",
  },
  {
    country: "NL",
    name: "Radio Two",
    folder: "radio_two",
    url: "https://example.com/two",
    codec: "mp3",
  },
];

/**
 * Stub fetch so /api/settings returns the three-country rows, /api/settings2 is
 * empty, and /api/app-config/public carries the given country_order (listed
 * countries first). Drives the country-grouped stream picker.
 */
function stubFetchForGroups(countryOrder: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/app-config/public")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              title: "",
              default_stream_folder: "",
              country_order: countryOrder,
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
          new Response(JSON.stringify(GROUP_STREAM_ROWS), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 404 }));
    }),
  );
}

describe("App stream picker country grouping", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    loadedUrls.length = 0;
    resetFakeWs();
  });

  it("renders a non-selectable optgroup per country in country_order with full-name labels and the stations grouped under them", async () => {
    stubFetchForGroups(["BE", "NL"]);
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    // Wait for the streams + country_order to settle (first ordered stream of
    // Belgium is preselected).
    await waitFor(() => {
      expect(selector.value).toBe("radio_four");
    });

    // Country headers are rendered as <optgroup> elements — inherently
    // non-selectable — in the configured country_order: Belgium, Netherlands,
    // then the unlisted France last. The labels are the full country NAMES.
    const groups = Array.from(selector.querySelectorAll("optgroup"));
    expect(groups.map((g) => g.getAttribute("label"))).toEqual([
      "Belgium",
      "Netherlands",
      "France",
    ]);

    // Each station is an <option> nested UNDER its country's optgroup (the
    // native, non-selectable header + indented stations), preserving the
    // per-country input order (Radio One before Radio Two within NL).
    const optionsByGroup = groups.map((g) =>
      Array.from(g.querySelectorAll("option")).map((o) => ({
        value: o.value,
        label: o.textContent,
      })),
    );
    expect(optionsByGroup).toEqual([
      [{ value: "radio_four", label: "Radio Four" }],
      [
        { value: "radio_one", label: "Radio One" },
        { value: "radio_two", label: "Radio Two" },
      ],
      [{ value: "radio_six", label: "Radio Six" }],
    ]);
  });

  it("still selects a station and drives the existing load behavior", async () => {
    stubFetchForGroups(["BE", "NL"]);
    renderWithMantine(<App />);
    const selector = document.getElementById(
      "stringSelector",
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(selector.value).toBe("radio_four");
    });

    // Selecting a station (nested under its optgroup) updates the value, and
    // the existing selectedCodec/download wiring follows: the hour-download
    // anchor picks up the newly-selected stream's folder in its filename.
    fireEvent.change(selector, { target: { value: "radio_one" } });
    await waitFor(() => {
      expect(selector.value).toBe("radio_one");
    });
  });
});

// --- Header no longer renders a color-scheme toggle ------------------------

describe("App header has no color-scheme toggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders no 'Color scheme' control in the player view", () => {
    renderWithMantine(<App />);
    expect(
      screen.queryByRole("radiogroup", { name: /color scheme/i }),
    ).toBeNull();
    expect(screen.queryByLabelText(/color scheme/i)).toBeNull();
  });
});
