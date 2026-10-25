import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Group,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ApiError, changePassword } from "../api";
import { Panel } from "../ui";

/**
 * Current/new password form -> changePassword(). Restyled to the Mantine
 * AI-Studio house style (Panel + Mantine PasswordInput/Button/Alert); it stays
 * a real <form onSubmit>, keeps the current-password/new-password autoComplete
 * hints and the <h2> heading verbatim.
 */
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
    <section className="settings-section">
      <Title order={2}>Change password</Title>

      <Panel mt="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <PasswordInput
              label="Current password"
              value={currentPassword}
              autoComplete="current-password"
              onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            />
            <PasswordInput
              label="New password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(e) => setNewPassword(e.currentTarget.value)}
            />
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            {success && (
              <Text role="status" c="dimmed">
                Password updated.
              </Text>
            )}
            <Group>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Change password"}
              </Button>
            </Group>
          </Stack>
        </form>
      </Panel>
    </section>
  );
}
