import { useState, type FormEvent } from "react";
import { ApiError, postLogin } from "../api";

interface LoginFormProps {
  /** Called after a successful login so the page can re-check /auth/me. */
  onLoggedIn: () => void;
}

/** Username/password form -> postLogin(); re-checks auth on success. */
export default function LoginForm({ onLoggedIn }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await postLogin(username, password);
      onLoggedIn();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Login failed",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="settings-form">
      <h2>Sign in</h2>
      <label>
        Username
        <input
          type="text"
          value={username}
          autoComplete="username"
          onChange={(e) => setUsername(e.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
