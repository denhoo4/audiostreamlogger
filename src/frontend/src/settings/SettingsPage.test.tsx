import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  renderWithMantine,
  screen,
  waitFor,
} from "../test/render-with-mantine";
import SettingsPage from "./SettingsPage";

/**
 * SettingsPage renders the LoginForm when GET /auth/me says anonymous and the
 * management UI once it says authenticated. The page mounts a whole tree of
 * admin children that each fetch from the api; we stub fetch with a permissive
 * router returning empty/benign payloads so the page mounts cleanly, and stub
 * EventSource (JobViewer opens an SSE stream) so jsdom does not try a real
 * connection. Mirrors the fetch-stub style of App.test.tsx.
 */

class FakeEventSource {
  close() {}
  addEventListener() {}
}

/** A permissive fetch stub: /auth/me returns the configured auth state, every
 *  other endpoint returns a benign empty body so child components settle. */
function stubFetch(authState: { authenticated: boolean; username?: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          }),
        );

      if (url.includes("/auth/me")) return json(authState);
      if (url.includes("/api/app-config/public")) return json({ title: "Test" });
      if (url.includes("/api/streams")) return json([]);
      if (url.includes("/api/jobs/schedules")) return json([]);
      if (url.includes("/api/jobs/config/log_retention")) return json({ hours: 24 });
      if (url.includes("/api/jobs")) return json([]);
      if (url.includes("/api/worker/status"))
        return json({ last_heartbeat: null, status: null, current_job: null });
      if (url.includes("/api/analysis/summary"))
        return json({
          per_stream: [],
          overall: {
            total_hours: 0,
            storage_bytes: 0,
            recording_count: 0,
            avg_duration_seconds: null,
            earliest: null,
            latest: null,
            stream_count: 0,
          },
        });
      if (url.includes("/api/analysis/stream-health"))
        return json({
          window_hours: 24,
          generated_slot: { date: "2026-10-23", hour: "12" },
          unhealthy_count: 0,
          counts: {
            total: 0,
            unhealthy: 0,
            ok: 0,
            degraded: 0,
            down: 0,
            never: 0,
          },
          streams: [],
        });
      if (url.includes("/api/analysis/storage-estimate"))
        return json({
          retention_hours: 24,
          projection: {
            perStream: [],
            totalProjectedBytes: 0,
            retentionHours: 24,
          },
          actual_bytes: 0,
        });
      // Default: an empty object is safe for the remaining GETs.
      return json({});
    }),
  );
}

describe("SettingsPage auth gate", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the login form when /auth/me says anonymous", async () => {
    stubFetch({ authenticated: false });
    renderWithMantine(<SettingsPage />);

    // The LoginForm sign-in button appears once the auth check resolves.
    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    // Its heading (<h2>Sign in</h2>) is present too.
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    // The management UI (logout button) is NOT shown while anonymous.
    expect(
      screen.queryByRole("button", { name: "Log out" }),
    ).not.toBeInTheDocument();
  });

  it("renders the management UI when /auth/me says authenticated", async () => {
    stubFetch({ authenticated: true, username: "admin" });
    renderWithMantine(<SettingsPage />);

    // "Signed in as admin" + a Log out button mark the authenticated view.
    expect(await screen.findByText("Signed in as admin")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Log out" }),
    ).toBeInTheDocument();
    // The login form is not rendered when authenticated.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Sign in" }),
      ).not.toBeInTheDocument();
    });
  });

  it("does not render the tab bar while anonymous", async () => {
    stubFetch({ authenticated: false });
    renderWithMantine(<SettingsPage />);

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    // No tablist / tabs are shown before authentication.
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("renders the four tabs with Streams active by default", async () => {
    stubFetch({ authenticated: true, username: "admin" });
    renderWithMantine(<SettingsPage />);

    await screen.findByText("Signed in as admin");

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    for (const label of ["Streams", "Recordings & health", "Jobs", "System"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    // Streams is selected and its panel (StreamTable <h2>Streams</h2>) is shown.
    expect(screen.getByRole("tab", { name: "Streams" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("heading", { name: "Streams" }),
    ).toBeInTheDocument();
    // A panel from another tab is not mounted yet.
    expect(
      screen.queryByRole("heading", { name: "Recordings & health" }),
    ).not.toBeInTheDocument();
  });

  it("switches tabs: clicking a tab shows its panels and hides the others", async () => {
    stubFetch({ authenticated: true, username: "admin" });
    renderWithMantine(<SettingsPage />);

    await screen.findByText("Signed in as admin");

    // Open Recordings & health -> its single merged panel appears, the Streams
    // panel hides.
    fireEvent.click(screen.getByRole("tab", { name: "Recordings & health" }));
    expect(
      await screen.findByRole("heading", { name: "Recordings & health" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Streams" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Recordings & health" }),
    ).toHaveAttribute("aria-selected", "true");

    // Open Jobs -> job panels appear, recordings panels hide.
    fireEvent.click(screen.getByRole("tab", { name: "Jobs" }));
    expect(
      await screen.findByRole("heading", { name: "Scheduled jobs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Worker status" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recordings & health" }),
    ).not.toBeInTheDocument();

    // Open System -> system panels appear.
    fireEvent.click(screen.getByRole("tab", { name: "System" }));
    expect(
      await screen.findByRole("heading", { name: "Branding" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Change password" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Scheduled jobs" }),
    ).not.toBeInTheDocument();
  });
});
