# audiostreamlogger — TODO & status

Living document for open and future work. The full modernization roadmap is done
and merged to `origin/main`. For the story of what was built and why, see
[HISTORY.md](HISTORY.md); for how the system fits together see
[ARCHITECTURE.md](ARCHITECTURE.md); for working style and preferences see
[HANDOVER.md](HANDOVER.md).

Last updated: 2026-10-23.

> Branch `country-order-polish` (not yet merged): manual country ordering +
> Streams-table polish. See the Phase-3.7 entry below.
> Branch `ui-admin-tabs-restyle` (not yet merged): Phase-5 restyle of the remaining
> three admin tabs (Recordings & health, Jobs, System) to the Mantine house style.
> See the Phase-5 entry below.

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
- [x] Phase 3.6 — Streams tab INLINE row editing + tightened layout: DONE on branch
      `streams-inline-edit` (frontend-only; no backend/API/schema/compose/nginx
      change). The bottom add/edit `<form>` is gone: clicking `IconPencil` turns THAT
      row into inputs in place (Name/URL `TextInput`, Country/Codec/Bitrate-or-Bit-
      depth `NativeSelect` reusing the per-codec valid-combo logic), with Save
      (`IconCheck`) + Cancel (`IconX`) in the actions cell and the URL `Test`
      reachability button + inline result available while editing. A `+ New stream`
      button inserts a blank editable row whose Save calls `createStream`. The Folder
      column is removed from display (DEV-only, new streams only); folder still
      travels in every payload (api validator requires `^[a-z0-9_-]+$`). A new pure
      `settings/derive-folder.ts` derives the folder from the name for NEW streams
      (lowercase, spaces→`_`, strip non-allowlist, collapse repeats, `stream`
      fallback, `_2/_3` collision suffix + notice); EXISTING streams keep their STORED
      folder verbatim on update (never re-derived on a name edit, so recordings never
      move). Reorder arrows are stacked vertically (`IconChevronUp`/`IconChevronDown`);
      set-default became a compact star toggle (`IconStar`/`IconStarFilled`, filled =
      default, click to set/clear). `Table.ScrollContainer` fallback, accessibility,
      and both light/dark schemes preserved. Build + 92 tests green in
      `node:26-bookworm` (75 baseline + 12 derive-folder + net new StreamTable inline
      tests). Evidence in
      `.agents/tasks/audiostreamlogger-streams-inline-edit-2026-10-23/verification.md`.
- [x] Phase 3.7 — manual country ordering + Streams-table polish: DONE on branch
      `country-order-polish` (NOT yet merged). Adds an explicit admin-chosen country
      order persisted as an additive `app_config` key `country_order` (JSON array of
      uppercase ISO alpha-2 codes; no schema migration): new requireAuth
      `PUT /api/app-config/country-order` + `country_order` exposed on the public
      `GET /api/app-config/public`, documented in openapi, with node:test coverage
      (api 248→260 pass). Frontend consumes it via `api.ts` `getPublicConfig().country_order`
      + `setCountryOrder(codes)`. Shared framework-free helpers in
      `settings/country-order.ts` (`orderCountries` + `sortStreamsByCountryOrder`;
      listed countries first in order, the rest alphabetical BY NAME; per-stream
      `sort_order` within a country untouched). Admin `StreamTable` country GROUP
      HEADERS gained stacked Up/Down controls that move a whole country and persist
      via `setCountryOrder`; the player (`App.tsx`) selector orders its options by the
      same `country_order`. Polish: Default star moved to the far-left first column,
      tighter cell padding (`verticalSpacing xs`/`horizontalSpacing sm`), admin-only
      wider container (`AppLayout` gained a `size` prop; `main.tsx` passes `xl` for
      `/settings`, player stays `lg`), and a stronger dark country-header contrast
      (`#1e2a44`; light scheme unchanged). Build + 103 vitest pass / api 260 pass, all
      0-fail, in `node:26-bookworm`.
- [ ] Phase 4 — the player (public `/` screen): stream selection, the WaveSurfer
      waveform, playback controls, download/fragment-cut. Most visible screen.
      USER REQUESTS for the Phase-4 design round (2026-10-23):
      - Replace the plain date/hour input with a real CALENDAR (Mantine
        `DatePickerInput`/`DatePicker`, likely needs `@mantine/dates`) where MONDAY is
        the first day of the week (`firstDayOfWeek={1}`). For the SELECTED stream, only
        days that actually HAVE recordings are selectable/active — disable/grey out
        days with none. Data is in `/api/settings2` (browse tree stream → year → month
        → day → hours[]); extend the existing `player-hours` "existing hours" logic to
        whole DAYS. Keep the hour selector constrained to existing hours for the chosen
        day. Consider the same calendar for the gaps date-range in RecordingsAnalysis.
      - Redesign the player's CONTROL LAYOUT — it is too basic now. Group/arrange the
        controls (play/pause, stream/day/hour selectors, download, fragment-cut, zoom)
        into a cleaner, more considered layout. The current layout MAY be changed
        freely (user approved), as long as all controls/behaviour remain (WaveSurfer
        incl. scroll-to-zoom, selection export, download). A design decision, not just
        a reskin of existing positions.
- [x] Phase 5 — admin per tab (Streams → Recordings & health → Jobs → System), one
      step per tab, reusing the Phase-3 components. Streams done in Phase 3.6/3.7.
      The remaining three tabs (Recordings & health, Jobs, System) are DONE and merged
      to `origin/main` (branch `ui-admin-tabs-restyle`): STYLING/RESKIN ONLY, no
      api.ts/endpoint/SSE/schema/docker/nginx change. Final cross-feat verify green:
      `tsc -b` + `vite build` + 103/103 vitest in `node:26-bookworm`.
      - Recordings & health (`RecordingsAnalysis`, `StreamHealth`, `StorageEstimate`):
        content wrapped in the shared `Panel`, data in Mantine `Table` inside
        `Table.ScrollContainer`, gaps form on Mantine inputs; the `recording now`/
        `not recording` aria-labels and measured/estimated text preserved. Three test
        suites migrated to `renderWithMantine` (behaviour/role/text assertions, no
        removed-class selectors).
      - Jobs (`SchedulerConfig`, `JobViewer`, `WorkerStatus`): shared `Panel` +
        Mantine components; JobViewer `openJobStream` EventSource lifecycle and
        `mergeJob` logic and WorkerStatus 5s poll + 1s clock intervals preserved
        byte-for-byte; `skipped`/`skipped, busy` stays NEUTRAL (not an error colour).
        `JobViewer.test.tsx` migrated to `renderWithMantine`.
      - System (`BrandingSettings`, `BackupSettings`, `ChangePasswordForm`): shared
        `Panel` + Mantine inputs; favicon cache-bust preview, `saveBlob`/`dateStamp`,
        invalid-JSON inline error, file-input reset and form submit semantics kept
        (no test suites exist for these three).
      Every `<h2>` heading kept verbatim so `SettingsPage.test.tsx` tab-switching
      still resolves each panel by heading role+name. No new dependency (feedback
      stays inline via `Alert`/status regions, no toasts).
- [ ] Phase 5.5 — admin content reworks (user, 2026-10-23), not just styling:
      - Recordings & health: MERGE the three tables (analysis summary + stream-health
        + storage-estimate) into ONE per-stream table with columns: Stream, Total
        hours, Storage (current stored bytes), Range (earliest–latest), Health (the
        "Now" recording status, renamed from "Now" to "Health"), Bytes/hour, Projected
        size (per-stream steady-state projection). Above the table, show two summary
        lines separately (not in the table): "Projected total: <X> over <N>h retention"
        and "Currently on disk: <Y>". Improve wording where clearer. REMOVE the Gaps &
        coverage panel entirely. Combine the data client-side from the existing
        summary / stream-health / storage-estimate endpoints (no backend change
        expected).
      - Jobs: add LOG RETENTION (`log_retention`, hours) as a field INSIDE the cleaner
        block, positioned between the on/off toggle and the frequency/anchor fields
        (reuse the existing app_config `log_retention` setter). Change the job log view
        to show, for EVERY job type, only its MOST RECENT job — i.e. the latest
        cleaner, the latest peakfilegenerator, AND the latest reconcile (one row per
        type; drop the full live feed list). Also ensure RECONCILE is a first-class
        type in the scheduler block like the other two: an enable toggle + schedule +
        a Run-now button to trigger the reconciliation job on demand (the reconcile
        job type + daily schedule already exist on the backend from item 18; this
        exposes its schedule/Run-now controls in the admin UI if they are not already
        there).
      - System: the page-title (`app_title`) must ALSO drive the HEADER brand name in
        the AppLayout, on BOTH the main player page and the settings pages (currently
        the header shows a hardcoded "Dé radiologger"). Wire the header to the
        `app_title` from public config so it updates everywhere when the title changes.
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
