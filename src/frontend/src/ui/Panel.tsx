import { Card, type CardProps } from "@mantine/core";

/**
 * The house "surface": a themed Mantine `Card` that gives every admin screen the
 * same AI-Studio dark panel look — a slightly-lighter-than-body surface
 * (`dark-6`), a subtle 1px border, rounded corners and generous padding. Later
 * screens wrap their content in a `Panel` instead of repeating these defaults.
 *
 * It is intentionally thin: all Card props pass through, so callers can still
 * tweak padding/radius when a specific screen needs it. Colours come only from
 * the theme tokens (`--mantine-color-dark-6`), mirroring AppLayout — no new hex.
 */
export function Panel({ children, style, ...rest }: CardProps) {
  return (
    <Card
      withBorder
      radius="md"
      padding="lg"
      style={{
        backgroundColor: "var(--mantine-color-dark-6)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </Card>
  );
}
