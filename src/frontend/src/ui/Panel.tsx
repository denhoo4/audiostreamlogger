import { Card, type CardProps } from "@mantine/core";
import classes from "./Panel.module.css";

/**
 * The house "surface": a themed Mantine `Card` that gives every admin screen the
 * same AI-Studio panel look — a surface distinct from the body, a subtle 1px
 * border, rounded corners and generous padding. Later screens wrap their content
 * in a `Panel` instead of repeating these defaults.
 *
 * The surface colour is SCHEME-AWARE via `Panel.module.css` (`light-dark()`):
 * white in light mode, the slightly-lighter-than-body `dark-6` in dark mode
 * (dark unchanged). The `withBorder` border uses Mantine's default border,
 * which also flips per scheme, so the card reads in both. A caller-supplied
 * `style`/`className` still passes through.
 *
 * It is intentionally thin: all Card props pass through, so callers can still
 * tweak padding/radius when a specific screen needs it.
 */
export function Panel({ children, className, ...rest }: CardProps) {
  return (
    <Card
      withBorder
      radius="md"
      padding="lg"
      className={className ? `${classes.panel} ${className}` : classes.panel}
      {...rest}
    >
      {children}
    </Card>
  );
}
