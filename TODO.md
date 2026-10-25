# audiostreamlogger — TODO & status

Living document for open and future work. The full modernization roadmap is done
and merged to `origin/main`. For the story of what was built and why, see
[HISTORY.md](HISTORY.md); for how the system fits together see
[ARCHITECTURE.md](ARCHITECTURE.md); for working style and preferences see
[HANDOVER.md](HANDOVER.md).

Last updated: 2026-10-23.

## Current state

Everything shipped is merged and on `origin/main`. Working tree clean. Only the
items below are genuinely open.

## Open items

### Full frontend UI/UX overhaul — IN PROGRESS (phased)
Styling was kept intentionally minimal until now. The user wants to do a proper
UI/UX pass, step by step.
DECIDED (user, 2026-10-23):
- Component library / styling: **Mantine** (dark theme, full component set — tabs,
  tables, modals, badges, notifications; theming via MantineProvider tokens). Verify
  the Mantine version compatible with the current React 19 + Vite 8 setup before
  installing (no version assumptions).
- Visual direction: **Google AI Studio, dark theme** — deep near-black/dark-grey
  background, panels a shade lighter with soft borders (subtle borders over heavy
  shadows), one clear accent colour (AI-Studio-ish blue) for primary actions/active
  state, clean restrained typography, generous spacing, rounded corners. As of
  Phase 3.5 the UI follows the device light/dark setting (`auto`) with a header
  toggle and a matching AI-Studio light theme; dark remains the design anchor.
Phased order (foundation → screens → polish; done as sequential workflows since they
share the styling layer, NOT parallel):
- [x] Phase 1 — Mantine foundation + theme tokens: DONE and merged to
      `origin/main`. Installed `@mantine/core` +
      `@mantine/hooks` `8.3.18` (exact-pinned; looser `^18 || ^19` React peer range
      than v9's React-19.2 floor) + PostCSS deps (`postcss-preset-mantine`,
      `postcss-simple-vars`). Wrapped BOTH routes in `src/main.tsx` in
      `<MantineProvider defaultColorScheme="dark">` with `<ColorSchemeScript
      defaultColorScheme="dark" />` (no light flash), imported
      `@mantine/core/styles.css`, and added `src/theme.ts` with the AI-Studio dark
      tokens (near-black body, lighter panels, subtle 1px borders, one blue accent,
      system sans, rounded corners, generous spacing). No screen restyled. Build +
      64 tests still green in `node:26-bookworm`.
- [x] Phase 2 — layout shell: DONE and merged to `origin/main` (branch
      `ui-layout-shell`). Shell-only pass: new shared `AppLayout` (dark AI-Studio header bar on
      `dark-6` with a 1px `dark-4` bottom border + centered max-width `Container`),
      wrapped around BOTH routes in `src/main.tsx` (App.tsx kept Mantine-free so its
      direct-render test stays green). Admin tab nav converted from the hand-rolled
      button tablist to Mantine `<Tabs keepMounted={false}>` (same 4 tabs/grouping,
      login stays outside the tabs). Only Phase-1 theme tokens used, no new colours,
      no panel/player-control restyle, no new dependency. Added a `window.matchMedia`
      stub to the vitest setup and moved `SettingsPage.test.tsx` onto
      `renderWithMantine`. Build + 64 tests green in `node:26-bookworm`.
- [x] Phase 3 — shared base components + Streams-tab proof: DONE and merged to
      `origin/main` (branch `ui-components-streams`). Added a thin shared `src/ui/`
      layer —
      `StatusBadge` (the single stream-health/recording state→colour map) and `Panel`
      (the AI-Studio dark `Card` surface) — plus a `ui/README.md` documenting the
      house conventions for using Mantine `Button`/`TextInput`/`NativeSelect`/`Table`/
      `Alert`/`Modal` directly. `@mantine/notifications` (toasts) was deliberately NOT
      added: Streams surfaces all feedback inline, so adding it would be an
      un-requested UX change and a needless lockfile regen (lockfile stays unchanged,
      `npm ci` still valid). Restyled ONLY the Streams tab (`StreamTable`) to Mantine
      in the dark style — `Table` inside a `Panel`, `NativeSelect`/`TextInput` form
      fields, `ActionIcon` reorder, inline `Alert` feedback, and a `Modal` for the
      typed-confirm delete — preserving every behaviour, accessible name, and api.ts
      call (reskin, not a logic change). Build + 73 tests green in `node:26-bookworm`
      (64 baseline + 8 StatusBadge + 1 delete-Modal contract test). Evidence in
      `.agents/tasks/ui-components-streams-2026-10-23/verification.md`.
      - Follow-up fix (branch `fix-streamtable-overflow`): the restyled `Table`
        overflowed its `Panel`/`Container` to the right (long un-wrapping URLs forced
        the table wider than the container), clipping the URL tail and the Edit/Delete
        actions column. Fixed as layout-only: `layout="fixed"` with stable widths for
        the Default/Order/actions columns, the URL cell truncates with an ellipsis and
        keeps the full value in a `Tooltip` + `title`, and the table is wrapped in
        `Table.ScrollContainer type="native"` (minWidth 720) as a narrow-viewport
        fallback. No behaviour/api change; build + 73 tests still green.
- [x] Phase 3.5 — auto light/dark + light theme + header toggle, plus two
      Streams-tab refinements: DONE on branch `ui-auto-colorscheme` (styling/theme
      only; no backend/API/schema/compose/nginx change). The app now follows the
      device's `prefers-color-scheme` on first paint via Mantine `auto`
      (`<ColorSchemeScript defaultColorScheme="auto" />` + `MantineProvider
      defaultColorScheme="auto"`) and switches live; a compact header
      `ColorSchemeToggle` (System/Light/Dark `SegmentedControl`, accessible labels +
      tooltips) lets the user override or return to following the device, persisted by
      Mantine. A proper LIGHT theme was added in the AI-Studio spirit (clean
      near-white body, white panels, subtle light borders, same blue accent, readable
      dark text) while DARK stays visually unchanged: the custom dark-only surfaces
      were made scheme-aware via `light-dark()` in CSS Modules — `AppLayout` header
      (`dark-6`/`dark-4` → `light-dark(gray-0, dark-6)` + `--mantine-color-default-border`),
      `Panel` card (`dark-6` → `light-dark(white, dark-6)`). `StatusBadge` kept its
      scheme-aware named colours. Streams tab: the country group header now clearly
      stands out (tinted scheme-aware background, dividers + blue left accent, heavier/
      larger type) with indented stream rows, and the Edit/Delete text buttons became
      icon `ActionIcon`s (`IconPencil` / red `IconX`) with accessible aria-labels and
      tooltips — the typed-confirm delete flow is unchanged. New dependency:
      `@tabler/icons-react@^3.49.0` (only new dep; lockfile regenerated, `npm ci`
      reproduces it). Build + 75 tests green in `node:26-bookworm` (73 baseline + 2
      ColorSchemeToggle). Evidence in `src/frontend/.plan/verification.md`.
- [ ] Phase 4 — the player (public `/` screen): stream selection, the WaveSurfer
      waveform, playback controls, download/fragment-cut. Most visible screen.
- [ ] Phase 5 — admin per tab (Streams → Recordings & health → Jobs → System), one
      step per tab, reusing the Phase-3 components.
- [ ] Phase 6 — polish: responsive/mobile, accessibility (focus states, contrast,
      keyboard), consistent loading/empty/error states, subtle motion.
Frontend-only (`src/frontend/`). No backend/API/schema change. WaveSurfer behaviour
(incl. scroll-to-zoom) must be preserved through the player restyle.

## Remaining tech debt (lower priority)

- [ ] Duplicated settings read + minute validation across services, with diverging
      bounds and messages. Fix: one shared `loadSettings()` + `validateMinute()`
      module. (Largely mooted by the DB migration, but the shared-validation nit
      remains.)

## Known failure modes / environment notes

Operational notes that still bite in practice:

- **Rebuild the whole stack after a frontend/api change** (`docker compose up -d
  --build`), not a single service. A stale image once rendered an "undefined"
  Stream Health panel.
- **New recorder/worker modules need a matching `COPY` line** in their Dockerfile —
  those images copy source files individually. A missing `COPY folder-utils.js`
  crashed the recorder at boot in production. Verify with a real `docker build`, not
  just `node --test`.
- The host has **no Node**: all node/npm/build/test runs happen inside the
  `node:26-bookworm` image and the service images (for ffmpeg/audiowaveform).
- A **live production stack runs on host port 9703** — never bind 9703 and never
  touch repo-root `./audio` or `./data`. Smoke tests use a throwaway temp dir, an
  alternate port, and `-p <project>`, and tear down with `docker compose down` (no
  `-v`).
- `.env` is gitignored; `.env.example` is the committed template. The running stack
  needs a real `SESSION_SECRET` or it falls back to an insecure dev secret with a
  warning.

(Working-style and process notes now live in [HANDOVER.md](HANDOVER.md).)
