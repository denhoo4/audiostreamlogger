import type { ReactNode } from "react";
import { Alert, Group, Loader, Text } from "@mantine/core";

export interface AsyncStateProps {
  /** When true (and no error), show the loading indicator instead of children. */
  loading?: boolean;
  /** Non-empty string renders an error Alert; takes precedence over everything. */
  error?: string | null;
  /** When true (and not loading/error), show the empty message instead of children. */
  empty?: boolean;
  /** Message for the empty state (defaults to a neutral placeholder). */
  emptyMessage?: string;
  /** Label beside the loader (defaults to the house 'Loading…'). */
  loadingMessage?: string;
  /** The ready content, rendered only when there is no error/loading/empty. */
  children: ReactNode;
}

/**
 * The single presentational vocabulary for an admin panel's three transient
 * states, already used ad-hoc across RecordingsHealth / WorkerStatus /
 * SchedulerConfig: a dimmed Loader row while loading, a red role='alert' Alert
 * on error, and a dimmed Text when there is nothing to show. It fetches
 * nothing and owns no state — callers pass the booleans/strings they already
 * compute, so routing a panel through it changes WHICH element renders but not
 * what data loads or when.
 *
 * Precedence (highest first): error, then loading, then empty, else children.
 */
export function AsyncState({
  loading = false,
  error = null,
  empty = false,
  emptyMessage,
  loadingMessage,
  children,
}: AsyncStateProps) {
  if (error) {
    return (
      <Alert color="red" role="alert">
        {error}
      </Alert>
    );
  }
  if (loading) {
    return (
      <Group gap="xs">
        <Loader size="sm" />
        <Text c="dimmed">{loadingMessage ?? "Loading…"}</Text>
      </Group>
    );
  }
  if (empty) {
    return <Text c="dimmed">{emptyMessage ?? "Nothing to show."}</Text>;
  }
  return <>{children}</>;
}
