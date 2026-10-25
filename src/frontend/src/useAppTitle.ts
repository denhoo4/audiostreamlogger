import { useEffect, useState } from "react";
import { getPublicConfig } from "./api";

/**
 * Shared default brand/title string. Factored into a single const so the
 * document.title fallback (useAppTitle), the brand fallback (useBrandTitle),
 * and AppLayout's default prop never drift apart.
 */
export const DEFAULT_APP_TITLE = "Dé radiologger";

/**
 * Set document.title at runtime from the public branding config, falling back
 * to the bundled default on error. Shared by the player (App) and the admin
 * /settings route so both derive the page title from the same source.
 *
 * The cancelled-guard cleanup mirrors the original inline effect in App.tsx so
 * a title fetch that resolves after unmount never writes a stale title.
 */
export function useAppTitle(): void {
  useEffect(() => {
    let cancelled = false;
    getPublicConfig()
      .then(({ title }) => {
        if (!cancelled && title) document.title = title;
      })
      .catch(() => {
        if (!cancelled) document.title = DEFAULT_APP_TITLE;
      });
    return () => {
      cancelled = true;
    };
  }, []);
}

/**
 * Value-returning counterpart to useAppTitle: fetches the public branding
 * config and returns the configured title for the header brand, falling back
 * to DEFAULT_APP_TITLE when the title is empty or the fetch fails. Reads the
 * same getPublicConfig source as useAppTitle so the header brand and
 * document.title stay in sync.
 */
export function useBrandTitle(): string {
  const [title, setTitle] = useState(DEFAULT_APP_TITLE);
  useEffect(() => {
    let cancelled = false;
    getPublicConfig()
      .then((config) => {
        if (!cancelled && config.title) setTitle(config.title);
      })
      .catch(() => {
        if (!cancelled) setTitle(DEFAULT_APP_TITLE);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return title;
}
