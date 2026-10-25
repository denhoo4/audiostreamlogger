import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import App from "./App";
import SettingsPage from "./settings/SettingsPage";
import AppLayout from "./AppLayout";
import { useBrandTitle } from "./useAppTitle";
import "./App.css";
// Mantine core styles. Imported AFTER App.css so the app's legacy CSS can still
// override where it needs to during the phased migration.
import "@mantine/core/styles.css";
import { theme } from "./theme";

// Lightweight view switch without a router dependency (design §2.6): the
// /settings path renders the admin view, everything else renders the existing
// anonymous player. nginx try_files already serves index.html for /settings, so
// a hard refresh / deep link works.
const isSettings = window.location.pathname.startsWith("/settings");

/**
 * App root. main.tsx is a module (not a component), so the brand-title hook
 * cannot be called at module scope — Root hosts it. useBrandTitle() reads the
 * same getPublicConfig().title source as useAppTitle's document.title, and the
 * resolved title flows into the AppLayout header brand on both routes.
 */
function Root() {
  const brandTitle = useBrandTitle();
  return (
    <AppLayout size={isSettings ? "xl" : "lg"} title={brandTitle}>
      {isSettings ? <SettingsPage /> : <App />}
    </AppLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Writes data-mantine-color-scheme before first paint from the device's
        prefers-color-scheme → the UI follows the OS light/dark setting on first
        paint with no flash, and switches live when the device setting changes.
        A header toggle (ColorSchemeToggle) lets the user override to
        light/dark or return to 'auto' (follow device). */}
    <ColorSchemeScript defaultColorScheme="auto" />
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Root />
    </MantineProvider>
  </StrictMode>,
);
