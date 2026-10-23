# Implementation Plan — New React + Vite Frontend for audiostreamlogger

## Context & decisions (grounded in the codebase)

All work happens in the worktree `/home/hoogden/Desktop/GIT/audiostreamlogger/.worktrees/frontend-react` on branch `frontend-react` (based on `main`). The new app lives in a NEW directory `frontend-react/` inside the worktree so it never collides with the legacy `frontend/` that the concurrent `security-update` branch edits. **Do not touch `frontend/web/`, `frontend/index.js`, `frontend/routes/*`, `frontend/package.json`, or any Docker/nginx files.**

Decisions (one or two sentences each):

- **Framework: React + Vite + TypeScript.** The user explicitly chose React ("Dit gaat groeien dus react"). Vite is the modern, simplest React toolchain and replaces the lost webpack setup. TypeScript is preferred for a project that will grow; it costs little here and documents the API shapes.
- **Build tool: Vite.** Produces a `dist/` static bundle, trivially servable the same way the legacy `web/` bundle was. No SSR needed.
- **wavesurfer.js v7 + `@wavesurfer/plugin-regions` (Regions plugin).** Firm requirement. v7 ships ESM and a React-friendly API. Keep the EXACT recovered visual config (below).
- **Drop flatpickr and lodash.** Firm requirement. Replace flatpickr with a native `<input type="datetime-local">` (keeps id `dateTimeSelector`; `new Date(value)` still parses its value). Replace lodash `round(10*x)/10` with plain `Math.round(x*10)/10`.
- **Selector data source: `GET /api/settings`** (the raw streams array), matching the OLD app exactly: each `<option>` has `value = stream.folder` and text `= stream.name.replace(/_/g, " ")`. `settings2` exists (nested browse tree keyed by display-name) but the legacy UI did not use it for the selector; we reproduce the actual behavior. Keep a typed client method for `settings2` available for future work but do not wire it into the UI.
- **No backend changes.** The new app is a pure client that calls the existing Express routes (`/api/settings`, `/util/selection-export`) and static `/audio/...` paths on the same origin.

### Recovered wavesurfer config (from the minified `frontend/web/main.js`)

Actual `WaveSurfer.create(...)` call in the old bundle:

```js
WaveSurfer.create({ container: "#waveform", waveColor: "violet", progressColor: "purple", normalize: true })
  .registerPlugin(RegionsPlugin.create())
```

- `waveColor: "violet"`, `progressColor: "purple"`, `normalize: true`, container `#waveform`.
- No `barWidth`/`barGap`/`barHeight`/`cursorColor`/`height` were set by the app, so **wavesurfer v7 defaults apply** (continuous waveform, default height 128, default cursor). Do NOT add bar styling — matching the old look means leaving these at default.
- Regions plugin registered with **no `enableDragSelection`** — selection is created via the Start/End buttons at the playhead, not by dragging on the waveform. Once a region exists it is `drag: true, resize: true` (movable/resizable). Only ONE region exists at a time (a single `rt` variable).

### Recovered app behaviors (from the same bundle)

- **Time display** (`#time-total`): format `M:SS` via `Math.floor(s/60) + ":" + String(s%60).padStart(2,"0")`, using rounded seconds. Updated on wavesurfer `timeupdate` and `ready`. Shows `current / total`.
- **On `finish`**: `setTime(0)`.
- **On `play`/`pause`**: toggle `#playPauseButton` label between `Pause`/`Play`.
- **Skip buttons** (`.skip-button`, `data-value` in seconds): `ws.skip(Number(value))`. Values: -60, -10, -1, +1, +10, +60.
- **Spacebar** (document keydown, key `" "` / code `Space`): toggle play/pause.
- **Load (`#load`)**: read `#stringSelector` (folder) and `#dateTimeSelector` (parse with `new Date(value)`, extract `YYYY`, `MM`, `DD`, `HH` padded to 2). Build `mp3Url = ${origin}/audio/${folder}/${folder}-${Y}-${M}-${D}-${H}.mp3` and `jsonUrl` = same with `.json`. Set the `#downloadbutton` anchor `href = mp3Url` and `download = ${folder}-${Y}-${M}-${D}-${H}.mp3`. If any part is `NaN` → `alert("Wel ff een uur selecteren hè!")` and stop. Otherwise `fetch(jsonUrl)` → if ok, `ws.load(mp3Url, json.data)` (precomputed peaks); on any error, `ws.load(mp3Url)` (decode mp3). Before loading, run the reset routine.
- **Reset routine** (old `st()`, runs on load): disable Download/Play Selection buttons, clear regions, `rt = null`, `seekTo(0)`, `pause()`, set Play label to `Play`.
- **Selection Start (`#createStartButton`)**: enable Download/Play Selection buttons. `t = ws.getCurrentTime()`. If a region exists: if `t < region.end` set `start = t`, else set `start = t, end = t+10`. If no region: create `{ start: t, end: t+10, drag: true, resize: true }`.
- **Selection End (`#createEndButton`)**: enable Download/Play Selection buttons. `t = ws.getCurrentTime()`. If a region exists: if `region.start < t` set `end = t`, else set `start = t-10, end = t`. If no region: create `{ start: t-10, end: t, drag: true, resize: true }`.
- **Delete Selection (`#deleteRegionButton`)**: disable Download/Play Selection buttons, clear regions, `rt = null`.
- **Play Selection (`#playRegionButton`, starts disabled)**: `region.play()`.
- **Download Selection (`#downloadRegionButton`, starts disabled)**: show `#downloadWait` (`display: inline`). Compute `startTime = Math.round(region.start*10)/10`, `endTime = Math.round(region.end*10)/10`. Parse `#dateTimeSelector` into `year`, `month`(2), `day`(2), `hour`(2). POST JSON `{ station_id: folder, year, month, day, hour, startTime, endTime }` to `${origin}/util/selection-export`. On non-ok: hide `#downloadWait`, throw. On ok: `blob()` → create object URL, make a temporary `<a download="Leuk fragmentje.mp3">`, click it, remove it, hide `#downloadWait`.
- **Optional parity extras** (present in old bundle; implement if cheap, otherwise omit — not required for parity sign-off): right-click on waveform pauses, double-click plays, mouse wheel zooms.

### Exact DOM / labels to reproduce (all Dutch, unchanged)

Title `Dé radiologger`. Elements with these ids/labels:
`#time-total` ("0:00 / 0:00"), `#waveform`, skip buttons "-1m"/"-10s"/"-1s"/"+1s"/"+10s"/"+1m" with the data-values above, `#playPauseButton` ("Play"/"Pause"), `#downloadbutton` ("Download uur"), `#createStartButton` ("Selection Start"), `#createEndButton` ("Selection End"), `#deleteRegionButton` ("Delete Selection"), `#playRegionButton` ("Play Selection", disabled), `#downloadRegionButton` ("Download Selection", disabled), `#stringSelector` (select), `#dateTimeSelector` (datetime input), `#load` ("Inladen!"), `#downloadWait` ("Download aan het voorbereiden, even geduld!", hidden red 30px text).

### Environment note (read before verifying)

This planning environment has **no Node/npm on PATH** (`node -v` → "Please ask your administrator"). The verification commands below assume the implementer's environment has Node 20+ (project targets `node:26-bookworm` in Docker, so a current Node is expected). If Node is unavailable in the implementer environment too, the implementer must report that it could not run `npm install`/`npm run build` rather than marking verification passed. Do NOT run docker builds (the `security-update` branch owns Docker). `.gitignore` already ignores `node_modules`; add the new app's `dist/` to a local ignore as noted in item 1.

---

## Plan

- [x] 1. Scaffold the Vite + React + TypeScript app in the new directory.
      Create the project skeleton manually (do not run `npm create vite` interactively): `package.json` with scripts `dev`/`build`/`preview` and deps `react`, `react-dom`, `wavesurfer.js` (v7 latest), and devDeps `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`; `index.html` with `<div id="root">` and `<title>Dé radiologger</title>`; `vite.config.ts` using `@vitejs/plugin-react`; `tsconfig.json` + `tsconfig.node.json` (standard Vite React-TS config); `src/main.tsx` mounting `<App />`; `.gitignore` inside the new dir with `node_modules` and `dist`. Pin wavesurfer to the latest v7 release line (the Regions plugin ships inside the `wavesurfer.js` package at `wavesurfer.js/dist/plugins/regions.js`, so no separate dependency is needed — confirm the subpath import resolves).
      Files: `frontend-react/package.json`, `frontend-react/index.html`, `frontend-react/vite.config.ts`, `frontend-react/tsconfig.json`, `frontend-react/tsconfig.node.json`, `frontend-react/src/main.tsx`, `frontend-react/src/App.tsx` (placeholder render), `frontend-react/.gitignore`
      Verify: `cd frontend-react && npm install && npm run build` completes with no errors and produces `frontend-react/dist/index.html`.

- [x] 2. Write the typed API client module.
      Create `src/api.ts` exporting: `getSettings()` → `GET /api/settings` returning `Stream[]` (`{ country: string; name: string; folder: string; url: string }`); `getSettings2()` → `GET /api/settings2` returning the nested browse-tree type (define it but it is unused by the UI for now); `audioMp3Url(folder, y, m, d, h)` and `audioJsonUrl(folder, y, m, d, h)` builders using `window.location.origin`; `exportSelection(body)` → `POST /util/selection-export` with the JSON body `{ station_id, year, month, day, hour, startTime, endTime }` returning the response `Blob` (throw on non-ok so the caller can hide the wait message). All requests target the same origin (no base URL, no CORS assumptions beyond what the backend already sets).
      Files: `frontend-react/src/api.ts`
      Verify: `cd frontend-react && npm run build` compiles with no TypeScript errors (the module is imported by `App.tsx` in later items).

- [x] 3. Implement the wavesurfer wiring as a reusable hook/module.
      Create `src/useWavesurfer.ts` (a hook) that, given the `#waveform` container ref, creates a WaveSurfer v7 instance with `{ waveColor: "violet", progressColor: "purple", normalize: true }`, registers `RegionsPlugin.create()`, and exposes: the instance, the regions plugin, `load(mp3Url, peaks?)`, play/pause/skip/seek helpers, current/duration time state, and `isPlaying`/label state wired to `play`/`pause`/`timeupdate`/`ready`/`finish` events (on `finish` → `setTime(0)`). Expose a single-region model (`rt`) with start/end helpers matching the recovered createStart/createEnd/delete logic. Clean up (`destroy()`) on unmount. Use the subpath import for the Regions plugin (`import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js"` or the v7-documented path — confirm which resolves during build and use it).
      Files: `frontend-react/src/useWavesurfer.ts`
      Verify: `cd frontend-react && npm run build` compiles with no errors; the Regions plugin import resolves (build fails loudly if the subpath is wrong).

- [x] 4. Build the full UI in `App.tsx` reproducing every control, id, and Dutch label.
      Render the exact DOM from the "Exact DOM / labels" section: title, `#time-total` (M:SS current/total), `#waveform` container, the seven transport buttons (six `.skip-button` with data-values + `#playPauseButton`), the selection row (`#downloadbutton` anchor, `#createStartButton`, `#createEndButton`, `#deleteRegionButton`, `#playRegionButton` disabled, `#downloadRegionButton` disabled), the selector row (`#stringSelector`, `#dateTimeSelector` as `<input type="datetime-local">`, `#load`), and the hidden red `#downloadWait` paragraph. Keep the legacy `.button` style for `#downloadbutton` (inline or a small `src/App.css`). Wire ALL behaviors from "Recovered app behaviors": populate the selector from `getSettings()` (value=folder, text=name with underscores→spaces), implement load (peaks-then-mp3-fallback, set download anchor attrs, NaN guard with the Dutch alert, reset routine), skip buttons, spacebar toggle, the createStart/createEnd/delete/playRegion logic enabling/disabling the selection buttons exactly as recovered, and the Download Selection flow (show `#downloadWait`, POST via `exportSelection`, trigger `<a download="Leuk fragmentje.mp3">`, hide `#downloadWait`, hide on error too). Replace lodash rounding with `Math.round(x*10)/10`.
      Files: `frontend-react/src/App.tsx`, `frontend-react/src/App.css` (optional)
      Verify: `cd frontend-react && npm run build` compiles with no errors and `frontend-react/dist/` is regenerated.

- [x] 5. Add a smoke test that the UI renders all controls with no console errors against a stubbed empty `/api/settings2` and `/api/settings`.
      Add a lightweight test using Vitest + @testing-library/react + jsdom (add these as devDeps and a `test` script; configure via `vite.config.ts` `test` block or a `vitest.config.ts`). The test mocks `fetch` so `/api/settings` returns `[]` (empty array) and `/api/settings2` returns `{}`, renders `<App />`, and asserts: the title text `Dé radiologger` is present; every control is present by id/label (`#time-total` shows "0:00 / 0:00", all seven transport buttons by label, `#downloadbutton`, the five selection buttons with `#playRegionButton` and `#downloadRegionButton` disabled, `#stringSelector`, `#dateTimeSelector`, `#load`, `#downloadWait` hidden); and that no `console.error` was called during render (spy on `console.error`). Mock/guard WaveSurfer so it does not try to decode real audio in jsdom (e.g., stub the `wavesurfer.js` module or guard creation when no audio URL is loaded) — the goal is a controls-render smoke check, not audio playback.
      Files: `frontend-react/src/App.test.tsx`, `frontend-react/vitest.config.ts` (or `test` block in `vite.config.ts`), `frontend-react/package.json` (add `test` script + devDeps)
      Verify: `cd frontend-react && npm run test -- --run` passes all assertions with zero `console.error` recorded.

- [x] 6. Final build + output check; confirm legacy frontend untouched.
      Run a clean build and confirm the dist artifacts exist. Confirm via `git status` that no files under `frontend/web/`, `frontend/index.js`, `frontend/routes/`, `frontend/package.json`, or any Docker/nginx file were modified — only `frontend-react/` and `.agents/` are new/changed.
      Files: (no edits; verification only)
      Verify: `cd frontend-react && npm install && npm run build` succeeds and `frontend-react/dist/index.html` + a hashed JS asset exist; `git -C /home/hoogden/Desktop/GIT/audiostreamlogger/.worktrees/frontend-react status --porcelain` shows no changes under `frontend/` or Docker/nginx files.

## Gaps / assumptions

- **`/api/settings2` vs `/api/settings` for the selector:** the OLD app used `/api/settings` for the stream dropdown; the task brief leans toward `settings2`. I preserve the actual legacy behavior (`/api/settings`) for exact parity and expose a typed `getSettings2()` for later. If the reviewer wants the browse tree wired in, that is a follow-up, not parity.
- **Backend `/api/settings2` latent bug:** `routes/api.js` calls `settingsData.map(...)` on the parsed object (which has a `streams` key, not an array), so `settings2` likely throws 500 at runtime. We do NOT fix it (no backend changes); the UI does not depend on it. Noted for awareness.
- **`dateTimeSelector` format:** legacy flatpickr used `Y-m-d H:i`; a native `datetime-local` yields `YYYY-MM-DDTHH:mm`, which `new Date(value)` parses correctly, so the hour-extraction logic is unchanged. Only the hour matters for the mp3 URL.
- **No Node in this planning env and no real audio files:** build/test must run in the implementer environment; audio-dependent playback cannot be exercised here, which is why item 5 is a controls-render smoke check, not a playback test.
