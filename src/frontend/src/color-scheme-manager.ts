import type { MantineColorSchemeManager } from "@mantine/core";

/**
 * A color-scheme manager that always resolves to the system preference.
 *
 * The header theme toggle was removed, so there is no manual override anymore.
 * Mantine's default localStorageColorSchemeManager() still reads the stale
 * 'mantine-color-scheme-value' key left behind by the old toggle, and that
 * stored value overrides defaultColorScheme='auto', stopping the app from
 * following the browser's prefers-color-scheme.
 *
 * This manager neutralizes that: get() always returns 'auto' (ignoring any
 * stored key) and set/subscribe/unsubscribe/clear are no-ops. Live OS switching
 * is handled by MantineProvider's own prefers-color-scheme matchMedia listener
 * while the resolved value stays 'auto'.
 */
export function systemColorSchemeManager(): MantineColorSchemeManager {
  return {
    get: () => "auto",
    set: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => {},
  };
}
