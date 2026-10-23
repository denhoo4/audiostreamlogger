import { useEffect } from "react";
import { getPublicConfig } from "./api";

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
        if (!cancelled) document.title = "Dé radiologger";
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
