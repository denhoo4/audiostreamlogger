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
  state, clean restrained typography, generous spacing, rounded corners. Dark is the
  default (and only) theme for now.
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
- [ ] Phase 2 — layout shell: global header, the admin tab navigation (already
      functional from item 27) restyled, page width/container, responsive behaviour.
- [ ] Phase 3 — shared base components: buttons, inputs, selects, tables, cards/
      panels, status badges (stream-health states), modals (the delete confirm),
      toast/feedback — built once on Mantine and reused everywhere.
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
