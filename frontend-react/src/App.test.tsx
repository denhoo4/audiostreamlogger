import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

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
    load() {}
    playPause() {}
    skip() {}
    seekTo() {}
    setTime() {}
    pause() {}
    getCurrentTime() {
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
    expect(document.getElementById("dateTimeSelector")).toBeInTheDocument();
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
