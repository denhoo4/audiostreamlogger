import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * Phase-1 design language — Google-AI-Studio-inspired DARK theme.
 *
 * This file is the single source of design tokens that phases 2–6 consume when
 * the actual screens get converted to Mantine. Phase 1 only wires it into the
 * MantineProvider; no component is restyled yet. Favour clarity over cleverness:
 * every token below is documented with what it maps to.
 *
 * Visual target (AI-Studio dark):
 *   - deep, near-black app background
 *   - panels/surfaces one shade lighter than the background
 *   - subtle 1px borders instead of heavy shadows
 *   - ONE clear blue accent
 *   - restrained, readable system typography
 *
 * Dark is the default AND only scheme this phase (no light-mode toggle).
 */

/**
 * The single accent colour — an AI-Studio-ish blue. Mantine needs a 10-shade
 * tuple (indices 0=lightest … 9=darkest). Index 6 is the primary shade used for
 * filled buttons etc. (see `primaryShade` below). Lighter shades (0–4) are for
 * light surfaces / hover tints, darker shades (7–9) for pressed states.
 */
const aiBlue: MantineColorsTuple = [
  "#e7f1ff", // 0 — lightest tint
  "#cfe0ff", // 1
  "#9dc0ff", // 2
  "#679eff", // 3
  "#3b82f6", // 4
  "#2574f0", // 5
  "#1a6cf0", // 6 — primary accent (AI-Studio blue)
  "#0a5bd6", // 7
  "#004fc0", // 8
  "#0043a8", // 9 — darkest (pressed)
];

/**
 * Dark surface palette. Mantine derives the global background from the dark
 * palette: `--mantine-color-body` uses index 7, default borders use index 4,
 * and panel/card surfaces use index 6. We tune those indices to express the
 * "near-black background, slightly-lighter surfaces, subtle borders" look while
 * keeping the rest of the tuple on Mantine's sensible defaults.
 */
const dark: MantineColorsTuple = [
  "#c9ccd4", // 0 — primary text on dark (light grey, high contrast)
  "#9aa0ad", // 1 — dimmed text
  "#6b7280", // 2 — placeholder / disabled text
  "#4a4f5a", // 3 — strong border / divider
  "#2a2d35", // 4 — default subtle 1px border
  "#20232b", // 5 — raised surface (e.g. hover)
  "#191c22", // 6 — panel / card surface (one shade lighter than body)
  "#111318", // 7 — app body background (deep near-black)
  "#0c0e12", // 8 — deepest background
  "#070809", // 9 — darkest
];

/**
 * A clean, restrained system sans stack — no web-font download, renders native
 * on every OS. Shared by body text and headings for a consistent AI-Studio feel.
 */
const systemSans =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const theme = createTheme({
  // One accent colour across the UI.
  colors: {
    aiBlue,
    dark,
  },
  primaryColor: "aiBlue",
  // Use shade 6 for the primary colour in dark scheme (the AI-Studio blue).
  primaryShade: 6,

  // Rounded corners everywhere by default — soft, modern AI-Studio surfaces.
  defaultRadius: "md",

  // Restrained, readable system typography.
  fontFamily: systemSans,
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  headings: {
    fontFamily: systemSans,
    fontWeight: "600",
  },

  // Slightly generous spacing scale for an airy, uncluttered layout.
  spacing: {
    xs: "0.625rem", // 10px
    sm: "0.875rem", // 14px
    md: "1.125rem", // 18px
    lg: "1.5rem", //   24px
    xl: "2rem", //     32px
  },
});
