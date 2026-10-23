# New React + Vite frontend for audiostreamlogger — 1:1 parity rebuild

A ground-up React + Vite + TypeScript frontend that reproduces the legacy minified `frontend/web/` UI control-for-control, keeping wavesurfer.js v7 + the Regions plugin and dropping flatpickr and lodash. It lives in a brand-new `frontend-react/` directory inside the worktree, calls the existing Express backend unchanged, and is intended as a clean base to grow from. The implementation follows the recorded plan closely, and the recovered wavesurfer config, Dutch labels, and control ids all match the legacy bundle verbatim.

Watch for: the task brief told the reviewer the selector consumes `/api/settings2` (nested station→year→month→day→hours), but the **actual legacy bundle fetches `/api/settings`** (confirmed) — the implementation correctly matches the real old app, so the brief's assumption is wrong, not the code. The three "optional parity extras" (right-click pause, double-click play, mouse-wheel zoom) present in the old bundle were omitted, which the plan explicitly flagged as acceptable (confirmed, non-blocking). Build/test evidence is recorded (verification.md + commit message); `node_modules`/`dist` are gitignored and not present in the worktree, so the build was not re-run here per instructions (confirmed).

**Verdict**: APPROVED

## High-level view

The DOM is a faithful port of the legacy static page. The legacy `index.html` carries the title "Dé radiologger" only in `<title>` with no visible heading, and the new app does the same — so "title present" means the document title, which is correct. Every control id, Dutch label, skip-button data-value, the "0:00 / 0:00" time display, the disabled-by-default Play/Download Selection buttons, and the hidden red downloadWait paragraph are reproduced exactly against the legacy markup.

The API contract is honored against the real backend. The selector is populated from `GET /api/settings` (`value=folder`, text `name.replace(/_/g," ")`) — verified against the legacy bundle, which uses the same endpoint and mapping. Audio URLs follow `/audio/<folder>/<folder>-YYYY-MM-DD-HH.mp3` with a `.json` peaks sibling tried first, and the "Download uur" anchor is pointed at that mp3. The selection export POSTs exactly `{ station_id, year, month, day, hour, startTime, endTime }` to `/util/selection-export`, which matches the fields the Express route destructures. The backend is untouched.

The wavesurfer wiring matches the recovered config: `waveColor "violet"`, `progressColor "purple"`, `normalize true`, all other visuals left at v7 defaults, Regions plugin registered without drag-selection. The single-region selection model reproduces the old createStart/createEnd/delete logic, including the "extend vs reset to ±10s" branches, and the enable/disable gating of the selection buttons tracks region existence.

Known gaps are small and documented. The brief's `/api/settings2` expectation does not match the old app (the code is right). Three optional UX extras from the old bundle were dropped by explicit plan decision. The `/api/settings2` endpoint has a pre-existing backend bug and the download-selection error path logs rather than re-throwing — neither blocks parity sign-off.

<details>
<summary>Issues (4)</summary>

1. **Brief vs. reality on the selector endpoint** — the task brief says `/api/settings2` (nested tree); the real legacy bundle uses `/api/settings`. The code correctly matches the old app, so no change is needed, but the brief's premise should be corrected in follow-up so the next reviewer isn't misled.
2. **Optional parity extras omitted** — right-click-to-pause, double-click-to-play, and mouse-wheel zoom exist in the old bundle but are not implemented. The plan marked these optional; add them later if the extra interactions are wanted.
3. **Download-selection error handling is softer than legacy** — the old app re-threw on a failed export; the new handler logs to console and silently hides the wait message, leaving the user with no visible error. Consider surfacing a user-facing message.
4. **StrictMode double-mounts the wavesurfer effect in dev** — `<StrictMode>` double-invokes the create/destroy effect in development only. Harmless (cleanup destroys the instance, stripped in prod), noted so it isn't mistaken for a leak.

</details>

<details>
<summary>Details</summary>

### DOM and label parity — ported against the legacy markup, not from memory

The legacy `frontend/web/index.html` was read directly and compared element by element. The container structure (centered time span, `#waveform`, the transport row with three skip buttons / Play / three skip buttons, the selection row, the selector row, the hidden red paragraph) is reproduced with identical ids and Dutch labels. Skip-button data-values match (−60/−10/−1/+1/+10/+60), `#playRegionButton` and `#downloadRegionButton` render `disabled`, and `#downloadWait` is styled `color:red; font-size:30px` with `display:none` until a download is in flight.

The one thing to be explicit about: the legacy page has no visible `<h1>` — "Dé radiologger" lives only in `<title>`. The new `index.html` keeps it in `<title>` and adds no heading, which is the correct parity choice. If the brief's "title present" was read as expecting a visible heading, that expectation would be a divergence from the old app, not a defect in this one.

### Selector endpoint: code matches the real old app, brief is wrong

The brief states the selector consumes `/api/settings2` with a nested station→year→month→day→hours structure. The legacy bundle was grepped and fetches `${origin}/api/settings` exactly once to build the dropdown, mapping each stream to `value=folder` / text `name.replace(/_/g," ")`. The new `getSettings()` + `App.tsx` reproduce that precisely. `getSettings2()` is defined in `api.ts` with a typed nested shape but deliberately unused, reserved for later browse-tree work.

Worth knowing: the backend `/settings2` route calls `settingsData.map(...)` on the parsed settings object (which is `{ streams: [...] }`, not an array), so that endpoint throws 500 at runtime. Pre-existing, untouched, and the UI does not depend on it — correctly left alone.

### Audio URL and download-selection contract

```
mp3:  /audio/<folder>/<folder>-YYYY-MM-DD-HH.mp3
json: /audio/<folder>/<folder>-YYYY-MM-DD-HH.json   (peaks, tried first)
```

`handleLoad` sets the `#downloadbutton` anchor to the mp3, runs the reset routine, fetches the peaks JSON, and on any failure falls back to decoding the mp3 (`ws.load(mp3Url)`). The export POST body is `{ station_id, year, month, day, hour, startTime, endTime }` with times rounded via `Math.round(x*10)/10` (the lodash replacement) — the Express route destructures exactly those seven fields, so the contract lines up.

One behavioral softening: the old app re-threw on a non-ok export so the failure propagated; the new handler catches, logs to `console.error`, and hides the wait message, leaving no user-visible error. The download simply doesn't happen. Minor, non-blocking, but the user feedback is weaker than before.

### Datetime input — native replacement is behaviorally equivalent

flatpickr is gone, replaced by `<input type="datetime-local" id="dateTimeSelector">`. The legacy code extracted parts via `getFullYear/getMonth/getDate/getHours` on `new Date(value)`; `parseDateParts` uses the identical methods with a `NaN` guard that triggers the same `alert("Wel ff een uur selecteren hè!")`. Only the hour granularity feeds the mp3 URL, and the native input's `YYYY-MM-DDTHH:mm` value parses through `new Date` the same way.

### wavesurfer v7 + Regions — config and selection model match

`useWavesurfer` creates the instance with `{ waveColor: "violet", progressColor: "purple", normalize: true }` and registers `RegionsPlugin.create()` from the v7 ESM subpath `wavesurfer.js/dist/plugins/regions.esm.js`. No bar styling or custom height is added, matching the old look (v7 defaults). The Regions plugin is registered without `enableDragSelection` — the legacy app did not call it either (the only `enableDragSelection` occurrence in the old bundle is the library's own method definition, verified), so selection is created only via the Start/End buttons.

The single-region model reproduces the recovered logic faithfully:

```
Start: t = currentTime
  region exists & t < region.end  -> start = t (keep end)
  region exists & t >= region.end -> start = t, end = t+10
  no region                       -> create {t, t+10}
End:   t = currentTime
  region exists & region.start < t -> end = t (keep start)
  region exists & region.start >= t-> start = t-10, end = t
  no region                        -> create {t-10, t}
```

Delete clears the region and disables the selection buttons; `hasRegion` drives the `disabled` state of Play/Download Selection, so they start disabled and enable on first selection — matching the old gating. `finish` seeks to 0 and clears the playing state, as recovered. Time display uses `M:SS` with rounded seconds via `formatTime`, wired to `timeupdate`/`audioprocess`/`ready`.

A dev-only note: `main.tsx` wraps the app in `<StrictMode>`, which double-invokes the create/destroy effect in development. The cleanup calls `ws.destroy()`, so no leak results, and StrictMode is stripped from production builds. Flagged only so the double create/destroy in dev isn't mistaken for a bug.

### Dependencies and build evidence

`package.json` lists `wavesurfer.js@7.12.12`, `react`/`react-dom` 18, and no flatpickr or lodash (confirmed). Verification is recorded in `.agents/tasks/verification.md` and the commit message: run inside a one-off `node:20-bookworm` container (no Node on host), `npm install` added 185 packages (exit 0), `npm run build` (`tsc -b && vite build`) succeeded producing `dist/index.html` + hashed `assets/index-<hash>.{js,css}` (exit 0), and the Vitest smoke test passed with zero `console.error`. `node_modules` and `dist` are gitignored and absent from the worktree, which is consistent with a containerized build; per instructions the suites were not re-run and there is no specific doubt that would justify a spot-check — the Regions ESM subpath is the documented v7 path and the recorded build passed on it.

### Smoke test coverage

`App.test.tsx` stubs `fetch` (`/api/settings` → `[]`, `/api/settings2` → `{}`), stubs the wavesurfer and regions modules so jsdom never decodes audio, renders `<App />`, and asserts every control by id/label, the "0:00 / 0:00" time text, the two disabled selection buttons, the hidden downloadWait, and that `console.error` was never called.

Not tested: actual audio load / peaks-vs-mp3 fallback, the selection create/extend branches, the export POST flow and download trigger, the spacebar toggle, and the NaN-guard alert. These need a populated settings response and a real (or more fully faked) wavesurfer instance. Acceptable for a controls-render smoke check and an initial base, but the selection math and export flow are the highest-value things to cover as the app grows.

### Non-disturbance

`git status` is clean and the single commit touches only new paths under `frontend-react/` and `.agents/`. Nothing under `frontend/web/`, `frontend/index.js`, `frontend/routes/`, `frontend/package.json`, or any Docker/nginx file was modified — verified against the commit's file list. The new app is a self-contained directory as required.

</details>

<details>
<summary>File map</summary>

New files (branch `frontend-react`, single commit `10ffce3`):

- `frontend-react/index.html` — root HTML, `<title>Dé radiologger</title>`, `#root` mount.
- `frontend-react/package.json` — React 18 + Vite 6 + wavesurfer 7.12.12; no flatpickr/lodash.
- `frontend-react/src/main.tsx` — React root mount in StrictMode.
- `frontend-react/src/App.tsx` — full UI: all controls, load, selection, export flows.
- `frontend-react/src/api.ts` — typed client: getSettings/getSettings2, audio URL builders, exportSelection.
- `frontend-react/src/useWavesurfer.ts` — wavesurfer v7 + Regions hook, single-region selection model.
- `frontend-react/src/App.css` — legacy `.button` style for the download anchor.
- `frontend-react/src/App.test.tsx` — Vitest controls-render smoke test.
- `frontend-react/vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `.gitignore`, `README.md` — tooling/config.
- `.agents/tasks/plan.md`, `.agents/tasks/verification.md` — plan and recorded build/test evidence.

Full diff: `git -C /home/hoogden/Desktop/GIT/audiostreamlogger/.worktrees/frontend-react show 10ffce3`

</details>
