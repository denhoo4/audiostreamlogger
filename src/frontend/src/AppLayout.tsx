import type { ReactNode } from "react";
import { Box, Container, Group, Title } from "@mantine/core";
import type { MantineSize } from "@mantine/core";
import { ColorSchemeToggle } from "./ui";
import classes from "./AppLayout.module.css";

/**
 * Shared layout shell for both routes (the player in App.tsx and the admin
 * /settings view). Scope is the SHELL only: a consistent AI-Studio frame around
 * each view's existing content — no panel/control restyle.
 *
 * Shape: a top header/app bar on a scheme-aware surface with a subtle 1px
 * bottom border, holding a brand title on the left and a color-scheme toggle
 * on the right; below it a centered, max-width Container with generous padding
 * that renders the page content. The header surface/border flip per color
 * scheme via `AppLayout.module.css` (`light-dark()` + `--mantine-color-*`
 * vars); the body uses the scheme-aware `--mantine-color-body`. Dark mode is
 * visually unchanged; light mode gets a clean near-white header.
 *
 * Responsive: the Container is auto-centered and collapses to full width with
 * padding on narrow screens; the header Group stays usable on mobile.
 *
 * useAppTitle is intentionally NOT called here — App and SettingsPage each call
 * it already to keep document.title in sync with the branding config.
 */
export default function AppLayout({
  children,
  title = "Dé radiologger",
  size = "lg",
}: {
  children: ReactNode;
  title?: string;
  /** Max-width of the centered content Container (default 'lg'; admin uses 'xl'). */
  size?: MantineSize | (string & {});
}) {
  return (
    <Box
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--mantine-color-body)",
      }}
    >
      <Box component="header" px="lg" py="md" className={classes.header}>
        <Group justify="space-between" wrap="wrap">
          <Title order={1} size="h4">
            {title}
          </Title>
          {/* Right-side slot: the color-scheme toggle (System/Light/Dark). */}
          <Group gap="sm">
            <ColorSchemeToggle />
          </Group>
        </Group>
      </Box>
      <Container size={size} py="lg">
        {children}
      </Container>
    </Box>
  );
}
