import { useCallback, useEffect, useState } from "react";
import { getAuthMe, postLogout } from "../api";
import LoginForm from "./LoginForm";
import StreamTable from "./StreamTable";
import SchedulerConfig from "./SchedulerConfig";
import JobViewer from "./JobViewer";
import ChangePasswordForm from "./ChangePasswordForm";
import BrandingSettings from "./BrandingSettings";
import WorkerStatus from "./WorkerStatus";
import StreamHealth from "./StreamHealth";
import RecordingsAnalysis from "./RecordingsAnalysis";
import StorageEstimate from "./StorageEstimate";
import BackupSettings from "./BackupSettings";
import { useAppTitle } from "../useAppTitle";

/**
 * Admin /settings view. On mount it checks GET /auth/me: logged out -> login
 * form; logged in -> the stream CRUD table, change-password form, and a logout
 * button. The anonymous player route is served by <App/> instead (see main.tsx).
 */
export default function SettingsPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | undefined>(undefined);

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
      <BrandingSettings />
      <StreamTable />
      <SchedulerConfig />
      <WorkerStatus />
      <StreamHealth />
      <RecordingsAnalysis />
      <StorageEstimate />
      <JobViewer />
      <BackupSettings />
      <ChangePasswordForm />
    </main>
  );
}
