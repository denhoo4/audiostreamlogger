import { useCallback, useEffect, useState } from "react";
import { Tabs } from "@mantine/core";
import { getAuthMe, postLogout } from "../api";
import LoginForm from "./LoginForm";
import StreamTable from "./StreamTable";
import SchedulerConfig from "./SchedulerConfig";
import JobViewer from "./JobViewer";
import ChangePasswordForm from "./ChangePasswordForm";
import BrandingSettings from "./BrandingSettings";
import WorkerStatus from "./WorkerStatus";
import RecordingsHealth from "./RecordingsHealth";
import BackupSettings from "./BackupSettings";
import { useAppTitle } from "../useAppTitle";

/** The admin tabs. 'streams' is the default landing tab. */
type TabId = "streams" | "recordings" | "jobs" | "system";

const TABS: { id: TabId; label: string }[] = [
  { id: "streams", label: "Streams" },
  { id: "recordings", label: "Recordings & health" },
  { id: "jobs", label: "Jobs" },
  { id: "system", label: "System" },
];

/**
 * Admin /settings view. On mount it checks GET /auth/me: logged out -> login
 * form; logged in -> the management UI, which groups the existing panels into
 * four tabs (Streams, Recordings & health, Jobs, System) plus a logout button.
 * The anonymous player route is served by <App/> instead (see main.tsx).
 *
 * Only the active tab's panels are mounted. Panels that fetch on mount do so
 * when their tab is first opened; the JobViewer SSE stream opens when the Jobs
 * tab is shown and closes (via its own unmount cleanup) when another tab is
 * selected. No panel needs to stay mounted across tabs to keep a live
 * connection, so conditional rendering is safe here.
 */
export default function SettingsPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabId>("streams");

  // Set the page title from the configured app_title, same source as the player
  // route. Called unconditionally before the early returns to respect hook rules.
  useAppTitle();

  const checkAuth = useCallback(async () => {
    setChecking(true);
    try {
      const me = await getAuthMe();
      setAuthenticated(me.authenticated);
      setUsername(me.username);
    } catch (err) {
      console.error("Could not check auth state:", err);
      setAuthenticated(false);
      setUsername(undefined);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const handleLogout = useCallback(async () => {
    try {
      await postLogout();
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      await checkAuth();
    }
  }, [checkAuth]);

  if (checking) {
    return (
      <main className="settings-page">
        <p>Loading…</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="settings-page">
        <h1>Settings</h1>
        <LoginForm onLoggedIn={checkAuth} />
      </main>
    );
  }

  return (
    <main className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <div className="settings-user">
          {username && <span>Signed in as {username}</span>}
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>
      <Tabs
        value={activeTab}
        onChange={(value) => setActiveTab(value as TabId)}
        keepMounted={false}
      >
        <Tabs.List aria-label="Settings sections">
          {TABS.map((tab) => (
            <Tabs.Tab key={tab.id} value={tab.id}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="streams">
          <StreamTable />
        </Tabs.Panel>

        <Tabs.Panel value="recordings">
          <RecordingsHealth />
        </Tabs.Panel>

        <Tabs.Panel value="jobs">
          <SchedulerConfig />
          <JobViewer />
          <WorkerStatus />
        </Tabs.Panel>

        <Tabs.Panel value="system">
          <BrandingSettings />
          <BackupSettings />
          <ChangePasswordForm />
        </Tabs.Panel>
      </Tabs>
    </main>
  );
}
