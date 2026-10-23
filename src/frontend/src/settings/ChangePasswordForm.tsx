import { useState, type FormEvent } from "react";
import { ApiError, changePassword } from "../api";

/** Current/new password form -> changePassword(). */
export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not change password",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="settings-form">
      <h2>Change password</h2>
      <label>
        Current password
        <input
          type="password"
          value={currentPassword}
          autoComplete="current-password"
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </label>
      <label>
        New password
        <input
          type="password"
          value={newPassword}
          autoComplete="new-password"
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </label>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="settings-success" role="status">
          Password updated.
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
