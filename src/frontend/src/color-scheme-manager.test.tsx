import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { systemColorSchemeManager } from "./color-scheme-manager";

// Build a full MediaQueryList-shaped stub whose `dark` query reports `matches`.
function makeMatchMedia(prefersDark: boolean) {
  return (query: string): MediaQueryList =>
    ({
      matches: query.includes("dark") ? prefersDark : !prefersDark,
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

const STORAGE_KEY = "mantine-color-scheme-value";

describe("systemColorSchemeManager", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    // Simulate the stale key left behind by the removed header toggle.
    window.localStorage.setItem(STORAGE_KEY, "light");
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it("resolves to dark when the system prefers dark, ignoring the stale 'light' key", () => {
    window.matchMedia = makeMatchMedia(true);

    render(
      <MantineProvider
        defaultColorScheme="auto"
        colorSchemeManager={systemColorSchemeManager()}
      >
        <div />
      </MantineProvider>,
    );

    expect(
      document.documentElement.getAttribute("data-mantine-color-scheme"),
    ).toBe("dark");
  });

  it("resolves to light when the system prefers light", () => {
    window.matchMedia = makeMatchMedia(false);

    render(
      <MantineProvider
        defaultColorScheme="auto"
        colorSchemeManager={systemColorSchemeManager()}
      >
        <div />
      </MantineProvider>,
    );

    expect(
      document.documentElement.getAttribute("data-mantine-color-scheme"),
    ).toBe("light");
  });

  it("returns 'auto' from get() and exposes no-op mutators", () => {
    const manager = systemColorSchemeManager();
    expect(manager.get("light")).toBe("auto");
    expect(manager.get("dark")).toBe("auto");
    // No-ops must not throw.
    expect(() => {
      manager.set("dark");
      manager.subscribe(() => {});
      manager.unsubscribe();
      manager.clear();
    }).not.toThrow();
  });
});
