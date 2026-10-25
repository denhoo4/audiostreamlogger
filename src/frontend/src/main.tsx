import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import App from "./App";
import SettingsPage from "./settings/SettingsPage";
import AppLayout from "./AppLayout";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Writes data-mantine-color-scheme before first paint from the device's
        prefers-color-scheme → the UI follows the OS light/dark setting on first
        paint with no flash, and switches live when the device setting changes.
        A header toggle (ColorSchemeToggle) lets the user override to
        light/dark or return to 'auto' (follow device). */}
    <ColorSchemeScript defaultColorScheme="auto" />
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <AppLayout>{isSettings ? <SettingsPage /> : <App />}</AppLayout>
    </MantineProvider>
  </StrictMode>,
);
