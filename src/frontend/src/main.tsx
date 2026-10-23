import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SettingsPage from "./settings/SettingsPage";
import "./App.css";

// Lightweight view switch without a router dependency (design §2.6): the
// /settings path renders the admin view, everything else renders the existing
// anonymous player. nginx try_files already serves index.html for /settings, so
// a hard refresh / deep link works.
const isSettings = window.location.pathname.startsWith("/settings");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isSettings ? <SettingsPage /> : <App />}</StrictMode>,
);
