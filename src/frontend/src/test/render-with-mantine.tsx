import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { theme } from "../theme";

/**
 * Test render helper that wraps a component in the same MantineProvider + dark
 * theme the real app uses (see src/main.tsx).
 *
 * Phase-1 reality: no existing component uses Mantine yet, and the current
 * suites render components directly (not through main.tsx), so they pass
 * unchanged. This helper is a forward-looking foundation piece for phases 2–6,
 * when converted components will need Mantine context to render.
 *
 * Note: jsdom does not implement `window.matchMedia`, which Mantine's
 * color-scheme logic can call. If a suite that renders a Mantine component
 * later throws on `matchMedia`, add a `matchMedia` stub to src/test/setup.ts
 * at that point.
 */
export function renderWithMantine(ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MantineProvider theme={theme} defaultColorScheme="dark">
        {children}
      </MantineProvider>
    ),
  });
}

// Re-export the rest of Testing Library so suites can import everything from
// this helper if they prefer.
export * from "@testing-library/react";
