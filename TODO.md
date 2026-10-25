# audiostreamlogger — TODO & status

Living document for open and future work. The full modernization roadmap is done
and merged to `origin/main`. For the story of what was built and why, see
[HISTORY.md](HISTORY.md); for how the system fits together see
[ARCHITECTURE.md](ARCHITECTURE.md); for working style and preferences see
[HANDOVER.md](HANDOVER.md).

Last updated: 2026-10-23.

> Branch `peakfile-revert` (not yet merged): reverts the backend live current-hour
> peak regeneration (worker half) and folds the player's live reload into Load while
> decoding the current hour client-side + removing the redundant Refresh button
> (frontend half). Integration green. See the peakfile-revert item under Open items.

> Branch `country-order-polish` (not yet merged): manual country ordering +
> Streams-table polish. See the Phase-3.7 entry below.
> Branch `ui-admin-tabs-restyle` (not yet merged): Phase-5 restyle of the remaining
> three admin tabs (Recordings & health, Jobs, System) to the Mantine house style.
> See the Phase-5 entry below.
> Branch `admin-content-reworks` (not yet merged): Phase-5.5 admin content reworks
> (merged Recordings & health table, Jobs tab log-retention + latest-per-type job
> view + reconcile controls, header brand from app_title). See the Phase-5.5 entry.
> Branch `ui-polish` (not yet merged): Phase-6 polish — structural color-scheme
> follow fix + consistent loading/empty/error states + reduced-motion-aware motion +
> responsive/accessibility pass. Approved, ready for review. See the Phase-6 entry.

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
- [x] Phase 4 — the player (public `/` screen): stream selection, the WaveSurfer
      waveform, playback controls, download/fragment-cut. Most visible screen.
      DONE on branch `ui-player2` (restyle + rework, behaviour preserved):
      - Replaced the plain date input with a real CALENDAR: Mantine
        `DatePickerInput` from the new `@mantine/dates` dep, `firstDayOfWeek={1}`
        (Monday first). For the SELECTED stream, ONLY days that actually have
        recordings are selectable — all other days are disabled via `excludeDate`.
        The enabled-day set comes from a new pure helper `existingDaysFor(tree,
        displayName)` in `player-hours.ts`, which uses the SAME explicit `Settings2`
        cast as `existingHoursFor` (so `tsc -b` type-checks against the
        logs-flattened runtime tree) and guards on `hours.length > 0`. The hour
        selector stays constrained to `existingHoursFor` for the chosen day.
        DETERMINISTIC rule: changing the stream clears the selected date + hour, so
        the UI never shows a highlighted-but-disabled day or an out-of-range hour.
      - Redesigned the CONTROL LAYOUT into the Mantine AI-Studio house style
        (`Panel`/`Stack`/`Group`, `@tabler` icons): a transport zone (skip +
        icon-only play/pause with an `aria-label` "Afspelen"/"Pauzeren"), a
        selection zone (stream + calendar + hour), and a source/actions zone
        (download hour, selection tools, fragment download, a scroll-to-zoom hint).
        Stream + hour use `NativeSelect` (the house pattern; also keeps the native
        `<select>` test-interaction model). All controls/behaviour preserved —
        WaveSurfer incl. scroll-to-zoom, selection export, hour download, live-hour
        auto-refresh. New deps: `@mantine/dates@8.3.18` + `dayjs@1.11.13` (exact).
      - `App.test.tsx` migrated to the new DOM (date set through the calendar
        popover, play/pause by aria-label, mandatory non-empty settings2 stubs) and
        a new `existingDaysFor` unit suite added. Verify green in `node:26-bookworm`:
        `tsc -b` + `vite build` + 112/112 vitest, `npm ci` reproduces the lockfile.
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
- [x] Phase 5.5 — admin content reworks (user, 2026-10-23), not just styling: DONE
      on branch `admin-content-reworks` (NOT yet merged; frontend-only, no
      api.ts/endpoint/SSE/schema/docker/nginx change — reconcile was already a
      first-class backend job type). Cross-feat verify green: `tsc -b` + `vite build`
      + 109/109 vitest in `node:26-bookworm`. Implemented as three FEATs:
      - Recordings & health: the three panels (RecordingsAnalysis, StreamHealth,
        StorageEstimate) + their suites were REPLACED by a single `RecordingsHealth`
        panel — one per-stream table (Stream, Total hours, Storage, Range, Health,
        Bytes/hour, Projected size) merged client-side by folder from the existing
        summary/stream-health/storage-estimate endpoints, with the two summary lines
        ("Projected total: … over Nh retention", "Currently on disk: …") above it.
        Gaps & coverage UI removed (endpoint left untouched, now unused).
      - Jobs: the cleaner schedule card now holds the log-retention Hours field
        between the Enabled toggle and the frequency select (standalone bottom panel
        removed); JobViewer keeps the SSE lifecycle but shows at most one row per type
        (latest cleaner/peakfilegenerator/reconcile); reconcile renders as a scheduler
        peer with Enabled/Save/Run-now (already backed end to end).
      - System: AppLayout header brand now derives from `getPublicConfig().title` via
        a new `useBrandTitle()` hook wired through a `Root` wrapper in `main.tsx`, on
        both `/` and `/settings`, falling back to the shared `DEFAULT_APP_TITLE`
        ("Dé radiologger") when empty or the fetch fails.
      ORIGINAL REQUEST (for reference):
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
- [x] Phase 5.7 — player & admin UI fixes (user, 2026-10-23): DONE and MERGED to
      `main` (frontend-only, no api.ts/endpoint/SSE/schema/docker/nginx change, no new
      dependency). Six fixes:
      1. Translated every remaining Dutch UI string in the frontend to English
         (player chrome in `App.tsx` — labels, button text, the play/pause
         aria-label, DatePicker label/placeholder, hour label, the select-a-day
         alert, the download-wait text, the four `console.error` messages — plus the
         matching `App.test.tsx` accessible-name assertions). `DEFAULT_APP_TITLE`
         default brand changed "Dé radiologger" → "Audio Stream Logger" (the admin's
         user-entered title is untouched; stream/country/folder DATA values untouched).
      2. Fragment download SAVED filename is now
         `<streamname>_<start>_<end>.<ext>` with absolute wall-clock
         `YYYY-MM-DD_HH-MM-SS` stamps (recording hour base + region offsets) via a
         new pure `player-filename.ts` (`fragmentFilename`). The export REQUEST body
         is unchanged; the whole-hour download name is unchanged.
      3. Switching stream now KEEPS the current date + hour when BOTH still exist for
         the newly-selected stream (via `existingDaysFor`/`existingHoursFor`), clears
         both when the date is unavailable, keeps the date and clears only the hour
         when the day exists but the hour does not (replacing the old always-clear
         rule).
      4. Removed the header `ColorSchemeToggle` (component + its test deleted,
         re-export dropped, `AppLayout` header simplified). The scheme ALWAYS follows
         the browser `prefers-color-scheme` — `MantineProvider defaultColorScheme="auto"`
         + `ColorSchemeScript` stay; there is no manual override. (Supersedes the
         Phase-3.5 "header toggle" — both light and dark themes still work.)
      5. Waveform loading feedback: `useWavesurfer` now exposes `isLoading`/`loadError`
         (wired to WaveSurfer load-start → `ready`/`error`); `App.tsx` shows a
         `LoadingOverlay` over the waveform zone + a time `Skeleton` while loading,
         an inline error on failure, and reveals the waveform/time on ready.
      6. Play selection now plays ONLY the selection: seeks to the region start, plays,
         and auto-pauses exactly at the region end via a `timeupdate` guard (cleared on
         any manual transport so normal playback is never truncated). Normal play/pause
         unchanged; the button stays disabled with no selection.
      Build + 122 vitest green (`tsc -b` clean; review APPROVED, non-blocking
      stale-comment finding fixed; no new dependency). Verification evidence in
      `.agents/tasks/player-fixes-2026-10-23/`.
- [x] Player stream list: country GROUP HEADERS (user wish, 2026-10-23). DONE on
      branch `player-country-groups` (NOT yet merged; frontend-only, no
      api.ts/endpoint/SSE/schema/docker/nginx change, no new dependency). The public
      `/` player's stream picker stays a Mantine `NativeSelect`, now fed grouped
      `data` (Mantine's `{ group, items }` object format → one `<optgroup>` per
      country). Optgroup labels are inherently non-selectable and browsers indent the
      options beneath them, giving the requested non-selectable country header +
      one-step-indented stations with zero custom styling. A new exported pure helper
      `streamSelectGroups(orderedStreams)` in `App.tsx` buckets the already
      country-ordered streams into optgroups, labelling each with the full country
      NAME via `countryName()` (falls back to the raw code), preserving the existing
      `country_order` (`sortStreamsByCountryOrder` — listed countries first, then the
      rest alphabetically by name) and the per-country stream order. All player
      behaviour preserved (default-stream preselect, keep-if-valid date/hour on stream
      change, load, live-poll, selection). Build + 137/137 vitest green in
      `node:26-bookworm` (`tsc -b` + `vite build` clean; 135 baseline + 2 new
      country-grouping tests asserting optgroup labels in country_order + option
      membership + selection still drives load). Visually verify after
      `docker compose up -d --build frontend`.
- [x] Jobs tab: remove the SEPARATE Save button under Cleaner → Hours (log-retention)
      (user, 2026-10-23). DONE on branch `cleaner-save` (NOT yet merged; frontend-only,
      no api.ts/endpoint/SSE/schema/docker/nginx change). The standalone Hours Save
      button and its `handleSaveRetention` handler were removed from `SchedulerConfig`;
      the Hours input stays between the Enabled toggle and the Frequency select but is
      now persisted by the cleaner card's SHARED Save: `handleSave` folds a
      `setLogRetention(Number(retentionHours))` call (cleaner only) in after
      `updateSchedule`, so one click persists enabled + schedule + retention with a
      single combined status/error (via the shared `rowStatus`/`rowError`; the
      retention validation bounds `min={1}`/`max={8760}` and the load-error alert are
      preserved). Other job types (peakfilegenerator, reconcile) untouched;
      `setLogRetention` fires only for the cleaner. `SchedulerConfig.test.tsx` updated
      to the single-save model (three Save buttons, not four; cleaner Save calls both
      `updateSchedule` and `setLogRetention`; non-cleaner Saves never call
      `setLogRetention`). Build + 135/135 vitest green in `node:26-bookworm`
      (`tsc -b` + `vite build` clean; 133 baseline + 2 new cleaner-save tests).
- [x] FIX peak files + REVERT the live-hour peak regeneration (user diagnosis,
      2026-10-23). SYMPTOM: the current-hour peak `.json` is for the WHOLE hour's width
      but looks like a SHORT fragment stretched across the whole hour. ROOT CAUSE (user):
      this started with item 24's "refresh the waveform" feature — the live-hour peak
      regeneration generates peaks while the mp3 is only a few minutes long, producing a
      short peak file that the frontend stretches over the full hour and that isn't
      correctly replaced. DECISION (user): go BACK to the original model —
      - Generate ALL waveforms ONCE PER HOUR for the PREVIOUS (completed) hour only
        (the normal post-hour peakfilegenerator run), and
      - let the BROWSER compute the waveform for the CURRENT (in-progress) hour itself
        (WaveSurfer derives peaks client-side from the audio when there's no/incomplete
        `.json`), instead of the backend regenerating a live peak file.
      This effectively REVERTS item 24's backend current-hour peak regeneration
      (`src/worker/handlers/currenthourpeaks.js` + its worker timer) and removes the
      current-hour `.json` dependency. Keep the normal peakfilegenerator current-hour
      SKIP so it still only peaks completed hours. The player should load the `.json`
      for past hours and fall back to client-side decoding for the current hour.
      (The player's live-hour refresh/reload still works for the growing mp3; it just no
      longer relies on a backend-regenerated peak file.) Touches worker + frontend.
      DONE on branch `peakfile-revert` (both halves). FRONTEND (FEAT-002):
      `App.tsx` `reload()` now decodes the CURRENT Amsterdam hour client-side (cache-
      busted mp3, no `.json` fetch) and PAST hours load the `.json` with a graceful
      client-decode fallback when it is missing. WORKER (FEAT-001): deleted
      `currenthourpeaks.js` + its test and stripped the independent
      `CURRENT_HOUR_PEAK_MS` setInterval timer, import, exports, and shutdown-clear from
      `worker.js`; `peakfilegenerator.js` (with its current-hour skip + `currentHourStamp`
      export) is unchanged, so completed hours are still peaked on schedule. Integration
      verified in `node:26-bookworm`: worker Docker image builds + 58/58 `node --test`,
      frontend `tsc -b`/`vite build` clean + 133/133 vitest, no dangling
      `currenthourpeaks`/`CURRENT_HOUR_PEAK`/`regenerateCurrentHourPeaks`/
      `currentHourPeakTimer` references in `src/`.
- [x] Player: remove the REFRESH button if it's redundant with LOAD (user, 2026-10-23).
      DONE on branch `peakfile-revert` (FEAT-002, frontend-only). The live-refresh
      behaviour was folded into LOAD: `App.tsx` `reload()` now always cache-busts the
      CURRENT Amsterdam hour (`audioUrl(..., Date.now())`) and decodes it client-side
      with NO peaks fetch, so pressing Load mid-hour refetches the grown mp3 — the
      capability the separate Refresh button provided. The `Refresh` button,
      `handleRefresh`, `loadedRef`, and the `IconRefresh` import were removed; the
      `loaded` state + the live-poll `useEffect` stay. Build + 133/133 vitest green in
      `node:26-bookworm`.
- [x] Phase 6 — polish: responsive/mobile, accessibility (focus states, contrast,
      keyboard), consistent loading/empty/error states, subtle motion. DONE and merged
      to `origin/main` (branch `ui-polish`; frontend-only, no api.ts/endpoint/SSE/schema/
      docker/nginx change, no new dependency). Review APPROVED. Three FEATs:
      - FEAT-001 (color-scheme fix): after the Phase-5.7 header toggle removal,
        `MantineProvider` still defaulted to `localStorageColorSchemeManager()`, whose
        STALE `mantine-color-scheme-value` key (left from when the toggle existed)
        overrode `defaultColorScheme="auto"` and stopped the app from following the
        browser. Fix: a tiny custom `systemColorSchemeManager()` in
        `src/color-scheme-manager.ts` whose `get()` always returns `'auto'` and whose
        set/subscribe/unsubscribe/clear are no-ops, passed as
        `colorSchemeManager` to `MantineProvider`; `ColorSchemeScript` +
        `defaultColorScheme="auto"` kept (no flash). The provider's own
        `prefers-color-scheme` matchMedia listener drives live OS switching. A test
        proves a pre-seeded `'light'` key is ignored (dark system → `dark`, light
        system → `light`).
      - FEAT-002 (consistent states + motion): one shared presentational
        `ui/AsyncState` (error → `<Alert role='alert'>`; loading → `Loader` + dimmed
        text; empty → dimmed message; else children) routes RecordingsHealth,
        WorkerStatus, SchedulerConfig, JobViewer and StreamTable through a single
        state vocabulary WITHOUT changing which endpoints load or when. Added a gentle
        mount fade on the player panel + admin tab content (Mantine `Transition`,
        gated by `useReducedMotion`) and a global `@media (prefers-reduced-motion:
        reduce)` rule in `App.css`; Mantine default hover/active transitions kept.
      - FEAT-003 (responsive + a11y): responsive wrapping/stacking via Mantine props
        (selection selectors `w={{ base: '100%', xs: 'auto' }}`, responsive header
        padding, button `Group wrap='wrap'`) with no horizontal overflow and no
        layout-intent change; a11y audit confirmed every icon-only ActionIcon has an
        aria-label, zero focus-ring suppression, scheme-aware contrast tokens, and
        keyboard operability; added behaviour/role/aria tests only.
      Final gate green in `node:26-bookworm`: `npm ci` + `tsc -b` + `vite build`
      clean + 133/133 vitest (16 files; 122 baseline + 11 new). MERGED + PUSHED to
      origin/main. Verification evidence in `.agents/tasks/task-ui-polish-phase6/`.
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
