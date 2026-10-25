import "@testing-library/jest-dom/vitest";

// jsdom does not implement window.matchMedia, which Mantine's color-scheme and
// responsive logic calls when a Mantine component renders under a test. Provide
// a minimal stub so suites that render Mantine components (e.g. the SettingsPage
// Tabs) do not throw. Returns a never-matching MediaQueryList with no-op
// listeners — the suites assert DOM/roles, not media-query behaviour.
//
// `matches: false` is also what keeps the app's `auto` color scheme
// DETERMINISTIC under jsdom: a never-matching `prefers-color-scheme: dark`
// means `auto` always resolves to light here, so scheme-dependent assertions
// stay stable. Do not make this value random.
// jsdom also lacks ResizeObserver, which Mantine's SegmentedControl
// (FloatingIndicator) observes to position its moving highlight. The
// ColorSchemeToggle renders a SegmentedControl, so provide a no-op stub; the
// suites assert roles/behaviour, not layout measurements.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }) as MediaQueryList;
}
