import type { ReactNode } from "react";
import { Box, Container, Group, Title } from "@mantine/core";

/**
 * Shared layout shell for both routes (the player in App.tsx and the admin
 * /settings view). Phase-2 scope is the SHELL only: a consistent dark
 * AI-Studio frame around each view's existing content — no panel/control
 * restyle.
 *
 * Shape (plan §1): a top header/app bar on the slightly-lighter surface
 * (dark-6) with a subtle 1px bottom border (dark-4), holding a brand title on
 * the left and an empty right-side slot for small header content later; below
 * it a centered, max-width Container with generous padding that renders the
 * page content. All colours come from the Phase-1 theme tokens via Mantine CSS
 * vars — no hardcoded hex.
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
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <Box
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--mantine-color-body)",
      }}
    >
      <Box
        component="header"
        px="lg"
        py="md"
        style={{
          backgroundColor: "var(--mantine-color-dark-6)",
          borderBottom: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <Group justify="space-between" wrap="wrap">
          <Title order={1} size="h4">
            {title}
          </Title>
          {/* Right-side slot: room for small header content in a later phase. */}
          <Group gap="sm" />
        </Group>
      </Box>
      <Container size="lg" py="lg">
        {children}
      </Container>
    </Box>
  );
}
