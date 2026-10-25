import { Badge, type BadgeProps } from "@mantine/core";

/**
 * The vocabulary of states a StatusBadge can express across the admin UI. These
 * cover the two domains that currently need a coloured status pill:
 *   - stream health (from the analysis endpoint): ok | degraded | down | never
 *   - recording completeness:                     complete | partial | recording
 *
 * The colour map (design decision 6) draws ONLY from Mantine's built-in named
 * colours so it inherits the dark theme automatically — no new hex is invented:
 *   ok / complete            -> green
 *   degraded / partial       -> yellow
 *   down                     -> red
 *   recording                -> aiBlue (the theme accent — an active state)
 *   never                    -> gray
 */
export type StatusKind =
  | "ok"
  | "degraded"
  | "down"
  | "never"
  | "recording"
  | "complete"
  | "partial";

const COLOUR: Record<StatusKind, string> = {
  ok: "green",
  complete: "green",
  degraded: "yellow",
  partial: "yellow",
  down: "red",
  recording: "aiBlue",
  never: "gray",
};

/** Default human-readable label per state (overridable via `children`). */
const LABEL: Record<StatusKind, string> = {
  ok: "OK",
  degraded: "Degraded",
  down: "Down",
  never: "Never",
  recording: "Recording",
  complete: "Complete",
  partial: "Partial",
};

export interface StatusBadgeProps extends Omit<BadgeProps, "color"> {
  /** The status this badge represents; drives the colour and default label. */
  status: StatusKind;
  /** Optional label override; defaults to a readable label for the status. */
  children?: React.ReactNode;
}

/**
 * A thin, theme-driven status pill. It is the one genuinely reusable,
 * vocabulary-defining wrapper in the ui/ layer: everywhere a status needs a
 * colour, this component owns the single mapping so colours stay consistent.
 * It is a plain Mantine `Badge` underneath, so all Badge props pass through.
 */
export function StatusBadge({ status, children, ...rest }: StatusBadgeProps) {
  return (
    <Badge color={COLOUR[status]} variant="light" {...rest}>
      {children ?? LABEL[status]}
    </Badge>
  );
}
