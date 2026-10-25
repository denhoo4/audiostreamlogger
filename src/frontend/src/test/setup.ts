import "@testing-library/jest-dom/vitest";

// jsdom does not implement window.matchMedia, which Mantine's color-scheme and
// responsive logic calls when a Mantine component renders under a test. Provide
// a minimal stub so suites that render Mantine components (e.g. the SettingsPage
// Tabs) do not throw. Returns a never-matching MediaQueryList with no-op
// listeners — the suites assert DOM/roles, not media-query behaviour.
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
