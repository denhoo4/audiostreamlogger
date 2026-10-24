# audiostreamlogger — TODO & status

Living document tracking the modernization/cleanup of the project.
Last updated: 2026-10-23 (item 24 live-hour-refresh FEAT-001 DONE + committed locally on branch
`live-hour-refresh`, NOT pushed: a new worker handler `src/worker/handlers/currenthourpeaks.js` driven
by an independent `setInterval(CURRENT_HOUR_PEAK_MS)` (default 30s) in `worker.js`, decoupled from the
job busy lock, that full-rebuilds + overwrites only the PRIMARY current-hour peak `<base>.json` per
stream (per-stream codec ext; `.partN` out of scope); the existing peakfilegenerator current-hour SKIP
stays. worker node:test 56 → 63 green in node:26-bookworm + `docker build -f Dockerfile.worker`
succeeds. FEAT-002 frontend live-poll + cache-busting still pending. Earlier this day: item 23
storage-estimate DONE + MERGED to main AND pushed to origin/main:
requireAuth `GET /api/analysis/storage-estimate` + a StorageEstimate admin panel projecting
steady-state disk use from measured/estimated per-stream bytes/hour × the retention window, plus
actual on-disk bytes; read-only, api 223 + frontend 45 tests green. Review APPROVED; fast-forward
merged into `main`. Earlier this day: item 21 v2 DONE
+ MERGED to main (== b06db8b) AND pushed to origin/main,
review APPROVED: the first Stream Health panel was WRONG in practice — a TZ bug (route used ambient
`getHours()`/UTC while the recorder stamps Amsterdam-local slots) plus the `ok/degraded/down/never`
24h-gap model made the recorder-running case read "0 streams OK". Rebuilt as a TWO-SIGNAL design — a
**Now** green-check column (current Amsterdam hour-slot has a `recording` row) + a separate
informational **Last 24h** gap-summary column — with the TZ fixed via a new pure
`src/api/lib/amsterdam-slot.js` using `Intl.DateTimeFormat(timeZone:'Europe/Amsterdam', hourCycle:'h23')`.
Fast-forward merged into `main` and pushed. Re-verified green in node:26-bookworm: api 212 node:test
(incl. an Amsterdam-vs-UTC route regression) + frontend 42 vitest + clean build; the v1 `stream-health`
branch is superseded.
Earlier: item 22 DONE + MERGED to main: per-stream recording
quality — FEAT-001 api backend + FEAT-002 recorder/worker/api de-`.mp3`-ification + FEAT-003 frontend
(player per-codec extension + admin codec/bitrate/bit-depth controls) all landed; cross-FEAT
integration verification PASSED (one fix: opus pinned to 48000 Hz — libopus rejects 44100), semantic
review APPROVED (gate `.agents/tasks/stream-quality-2026-10-23/review.json` verdict=APPROVED, no
findings), fast checks re-run green in node:26-bookworm (api 211 / frontend 41 / worker 56 /
recorder 54, frontend build exit 0) and the branch fast-forward merged into `main` AND pushed to
origin/main (main == origin/main == 170642d). New test
baselines: api 211 (was 177), frontend 41 (was 37), worker 56, recorder 54. Recording files are now
named `<folder>-<stamp>.<ext>` (mp3/opus/flac) — no longer always `.mp3`. FEAT-001:
additive `codec`/`bitrate_kbps`/`bit_depth` columns + idempotent in-place migration, authoritative
server-side quality validation, service persistence with the behaviour-preserving mp3@160 default,
the three write call-sites forwarding the fields, a `codec` field on the public `/settings`
projection, backup round-trip, and the OpenAPI update. FEAT-002: pure `src/recorder/encoding.js`
per-codec ffmpeg ARRAY-arg resolver (mp3/opus/flac, defensive clamp to mp3@160) + the mandatory
`Dockerfile.recorder` COPY, extension-parameterised `segmentOutputName`, recorder wired to the
per-stream codec (output name + ffmpeg output-option array + recordings-row file_path), and the full
de-`.mp3`-ification across recorder/worker/api (filename parsers return the ext; worker
peakgen/reconcile scan `.mp3/.opus/.flac` and `upsertRecordingMeta` builds the real-ext file_path;
cleaner row-match via the widened parser; api browse lists opus/flac hours + selection-export gained
an `ext` field). recorder node:test 54 / worker 56 / api 211 green in node:26-bookworm, and
`docker build -f Dockerfile.recorder` succeeds with the new module. FEAT-003: `api.ts` gains a `Codec`
type + codec/bitrate_kbps/bit_depth on Stream/StreamRecord/StreamInput, `audioMp3Url` renamed to
`audioUrl(...,ext)`, and an optional `ext` on the selection-export body; `App.tsx` derives the player
URL / WaveSurfer load / download name / selection-export ext from the selected stream's codec;
`StreamTable.tsx` adds codec/bitrate/bit-depth controls that only offer valid per-codec combos (lossy
→ bitrate, lossless → bit-depth) so an invalid combo can never be submitted. frontend build +
vitest 37 → 41 green in node:26-bookworm (new App non-mp3 opus/flac load tests + StreamTable
codec-control tests); committed locally, NOT pushed. Earlier: item 17 DONE + MERGED to main: stream-ordering — manual stream ordering +
default stream + country-grouped admin view. FEAT-001 backend (additive `streams.sort_order` column +
idempotent in-place migration, sort_order-ordered reads, `PUT /api/streams/reorder`,
`default_stream_folder` app_config key with public read + `PUT /api/app-config/default-stream` setter)
and FEAT-002 frontend (country-grouped StreamTable with ▲/▼ global reorder + Set-default control +
badge, player preselects the default stream) both committed. Semantic review APPROVED (one non-blocking
`sort_order` TS-type note, an accepted trade-off) — verdict at
`.agents/tasks/stream-ordering-2026-10-23/verdict.json`. api 177 / frontend 37 tests green in
node:26-bookworm; fast-forward merged into `main` and pushed to origin/main (main == origin/main ==
9f1cec8, FEAT commits == 88fbf71). Earlier: item 14 DONE + MERGED to
main (fast-forward == d7b1ed8) from branch `stream-url-validation` — a NON-BLOCKING admin "Test" button
+ `POST /api/streams/test-url` reachability probe, decided with the user; plan at
`.agents/tasks/stream-url-validation-2026-10-23/plan.md`. Semantic review APPROVED (no blocking
findings; one non-blocking SSRF-denylist note, an accepted trade-off) — review + verdict at
`.agents/tasks/stream-url-validation-2026-10-23/review.md` / `review.json`. api 158 / frontend 26 tests
green in node:26-bookworm; branch + worktree cleaned up. Earlier: stream-health branch: item 21 admin
"which streams are NOT working" health
panel implemented on `.worktrees/stream-health` — read-only, derived from existing recordings rows,
api 139 / frontend 23 tests green; in review. Earlier: reconcile-job branch: FEAT-001 planner +
FEAT-002 worker reconcile job landed — see item 18. ALL FIVE CHUNKS (A–E) + all big steps DONE, merged, and pushed to
origin/main == d16304a. Full roadmap complete; see HANDOVER.md for a fresh-start briefing.
Dependabot + GitHub Actions are now enabled on the repo; its first run opened 10 PRs (#3–#12) —
see item 19 below for which are green/safe vs. red. Item 20 (API docs) is DONE: OpenAPI 3 via zod +
swagger-ui-express behind requireAuth, MERGED to main (fast-forward == a60165a). Item 19 is IN
PROGRESS: the four GREEN PRs (#3 nginx, #5 jsdom, #7 github-actions, #9 argon2) are merged onto the
`frontend-toolchain-upgrade` worktree branch, and the six RED interdependent frontend bumps
(#4/#6/#8/#10/#11/#12 — react 19, vite 8, vitest 5, @vitejs/plugin-react 6) have been bundled into
ONE coordinated upgrade on that worktree — CODED + VERIFIED GREEN in node:26-bookworm (build + 20/20
vitest + report-only coverage + npm ci reproducibility), committed on `frontend-toolchain-upgrade`,
and the semantic review is APPROVED (no blocking findings; gate review.json) — still NOT pushed/
merged; the merge/finalize step merges it and closes the superseded PRs. Plan + evidence + review
under `.agents/tasks/frontend-toolchain-upgrade-2026-10-23/`. Open feature items remaining: 19
(Dependabot PR triage). Item 17 (stream ordering / default stream / country grouping) is now DONE +
MERGED to main; items 18 (recordings reconcile job) and 21 (admin broken-stream health panel) were
completed earlier.)

STATUS SUMMARY (what is DONE + on origin/main):
- Node 26 Docker stack, 4 services: recorder, worker, api, frontend (cleaner + peakfilegenerator
  folded into the generic `worker`). `settings.json` is GONE — all config lives in the SQLite DB.
- React + Vite + TS frontend (wavesurfer v7 + regions + scroll-to-zoom); player at `/`, login-gated
  admin at `/settings`.
- SQLite DB (node:sqlite / DatabaseSync, journal_mode=DELETE, on the `./data` volume) owned by the
  api: tables streams, users, sessions, jobs, schedules, app_config, recordings. Argon2id auth,
  server-side session store, requireAuth.
- Job queue + DB-driven scheduler (worker): cleaner + peakfilegenerator job types, hourly/daily/
  weekly schedules, global single-job busy=SKIP lock, SSE live job view + Run-now admin UI.
- recordings table + analysis endpoints (`/api/analysis/summary` + `/gaps`) + admin analysis view.
- Recorder: hourly record + startup catch-up + 30s new-stream poll + per-stream ffmpeg supervision
  with backoff + graceful shutdown + greppable gap logging. recorder `./data` mount is read-write.
- Admin/branding: editable page title + favicon upload, worker status, existing-hours selector,
  DB backup/export + import. Stream names shown VERBATIM (no underscore→space).
- Code quality: execFileSync (no shell), per-service `log` helper, `npm ci` + committed lockfiles,
  real package.json metadata.
- Tests + CI + deps: api 114 / worker 37 / recorder 35 node:test, frontend 20 vitest; report-only
  coverage; `.github/workflows/ci.yml`; `.github/dependabot.yml`; `ARCHITECTURE.md` + `docs/TESTING.md`.
- `.env` is untracked (gitignored); `.env.example` is committed.

---

## Branches

### `live-hour-refresh` — IN PROGRESS (item 24: live auto-refresh of the currently-recording hour; FEAT-001 worker current-hour peak regen DONE + committed locally, NOT pushed; FEAT-002 frontend still pending)
Isolated git worktree at `.worktrees/live-hour-refresh` on branch `live-hour-refresh`. Task artifacts
under `.agents/tasks/` (context.json + features/FEAT-001..N.json). Scope so far is `src/worker/` only —
no SQLite schema change, no `journal_mode` change.
- **FEAT-001 — worker-side current-hour peak regen (DONE, committed locally).** New handler
  `src/worker/handlers/currenthourpeaks.js` exporting
  `regenerateCurrentHourPeaks(db, { now = new Date(), run = defaultRun } = {})`. For each
  `SELECT folder, codec FROM streams` row it builds the PRIMARY current-hour audio path
  `AUDIO_DIR/<folder>/<folder>-<stamp>.<ext>` (ext = `codec || 'mp3'`, FEAT-002; stamp via
  `currentHourStamp(now)` imported from `./peakfilegenerator`) and, if that file exists, FULLY
  regenerates + OVERWRITES its `<base>.json` peak file (same base, `.json` ext) via the injected `run`
  (default `execFileSync('audiowaveform', audiowaveformArgs(audioPath, jsonPath))`). `.partN` segments
  are ignored entirely (primary only — documented out-of-scope follow-up). A per-folder
  missing-file/audiowaveform failure is caught, logged via `./log` and counted, NEVER thrown (mirrors
  peakfilegenerator's per-file handling); it returns a short summary string. `worker.js` adds
  `const CURRENT_HOUR_PEAK_MS = Number(process.env.CURRENT_HOUR_PEAK_MS) || 30000;` and a SECOND
  INDEPENDENT `setInterval(CURRENT_HOUR_PEAK_MS)` in `start()` — separate from the heartbeat interval
  and the `setTimeout` poll loop, NOT routed through the job busy lock — that calls
  `regenerateCurrentHourPeaks(db)` wrapped in try/catch so a failure only logs and never crashes the
  worker; `CURRENT_HOUR_PEAK_MS` + `regenerateCurrentHourPeaks` are exported for testability. The
  existing peakfilegenerator current-hour SKIP, `tickOnce`, and the job loop are UNCHANGED. The new
  handler ships via the existing `COPY src/worker/ ./` (no Dockerfile.worker edit). Verified in
  node:26-bookworm: worker node:test 56 → 63 (new `src/worker/test/currenthourpeaks.test.js`: overwrite
  an existing current-hour primary, skip a folder with no current-hour file, honor the per-stream codec
  ext, ignore a `.partN`-only folder, catch+count an injected-run throw while other folders still
  process, stamp from the injected `now`, and null-codec → mp3 default) all green; `docker build -f
  Dockerfile.worker` succeeds.
- **FEAT-002 — frontend live-poll + cache-busting (PENDING).** Detect the selected hour IS the current
  Amsterdam hour, periodically reload the source + refreshed peak `.json`, add a manual refresh button,
  and cache-bust the live `/audio` URLs client-side. Consumes the json FEAT-001 regenerates.

### `stream-quality` — MERGED (item 22: per-stream codec/bitrate/bit-depth; ADDITIVE schema change; FEAT-001 api backend + FEAT-002 recorder/worker/api de-.mp3 + FEAT-003 frontend DONE; cross-FEAT integration PASSED (opus sample-rate fix), semantic review APPROVED, fast-forward merged into main)
Isolated git worktree at `.worktrees/stream-quality` on branch `stream-quality`. Task artifacts under
`.agents/tasks/stream-quality-2026-10-23/` (context.json + design.md + features/FEAT-001..N.json +
verification.md).

**MERGE (2026-10-23).** Semantic review APPROVED — gate
`.agents/tasks/stream-quality-2026-10-23/review.json` `verdict=APPROVED`, zero findings. The fast
checks were re-run green in node:26-bookworm one last time before merging: api 211 node:test,
frontend `npm ci && npm run build` exit 0 + 41 vitest, worker 56 + recorder 54 node:test. `main` was
still at `origin/main` (36c0bd7) with `stream-quality` four commits ahead on that exact tip, so no
rebase was needed; this living-doc update was committed on the branch, then `main` was
fast-forwarded to `stream-quality` and PUSHED to origin/main — a clean fast-forward, no force-push
(main == origin/main == stream-quality == 170642d; `origin/main` advanced 36c0bd7..170642d). A stale
uncommitted item-22 "DESIGNED + PLANNED" scratch edit lingering in the main-repo working-tree TODO.md
was discarded by hand during the merge (superseded by the branch's authoritative DONE+MERGED text; the
design detail it held lives in `.agents/tasks/stream-quality-2026-10-23/design.md`). New test baselines
to carry forward: api 211, frontend 41, worker 56, recorder 54. Recording files are now
`<folder>-<stamp>.<ext>` (mp3/opus/flac), no longer always `.mp3`.

**Cross-FEAT integration (2026-10-23) — PASSED with one fix.** All four suites green in
node:26-bookworm (api 211, frontend 41, worker 56, recorder 54); all four images `docker compose
build`; real per-codec e2e smoke (throwaway `--rm` worker image, no ports/host mounts) confirmed
mp3→mp3, opus→ogg, flac→flac containers each peak-readable via real `audiowaveform` and recognised by
both filename parsers + the cleaner row-match (aac excluded — clamped to mp3 and parsed to null);
cold-data compose stack healthy on alt port 9789 + torn down clean (9703 never bound, real volumes
cold). Fix: FEAT-002's `encoding.js` hard-coded `-ar 44100` for opus, but libopus only accepts
8k/12k/16k/24k/48k Hz and errors out on 44100 — i.e. **every opus recording would have crashed the
recorder**. The design table (§6) and §4 probe missed it (the probe let ffmpeg pick opus' default
48000). Fixed by pinning opus to its native 48000 Hz (`OPUS_SAMPLE_RATE`); mp3/flac keep 44100. No
user-facing change (sample rate is not a configurable control). See verification.md §2/§4.
Resolved codec allowlist: `mp3` / `opus` / `flac` (aac excluded — the worker image's audiowaveform
1.10.2 cannot read the AAC/M4A container; a documented follow-up). Schema change is ADDITIVE ONLY and
`journal_mode` stays DELETE.
- **FEAT-001 — api backend (DONE, committed).** `db/schema.js` adds a guarded idempotent
  `migrateStreamsQuality(db)` (called after `migrateStreamsSortOrder`) that ADDs
  `codec TEXT NOT NULL DEFAULT 'mp3'`, `bitrate_kbps INTEGER` (backfilled to 160 inside its own
  guard) and `bit_depth INTEGER` (NULL) — each ALTER independently guarded, no CHECK, journal_mode
  untouched. `lib/validate-stream.js` gains the authoritative `validateQuality`/`CODECS` gate
  (lossy mp3[96..320]/opus[64..192] require an in-set bitrate + forbid bit_depth; lossless flac
  requires bit_depth∈{16,24} + forbids bitrate; codec compared case-sensitively; all-absent → valid
  so the service fills the mp3 default). `services/streams.js` persists the three columns on
  create/update (mp3 default when all omitted) and returns them from every SELECT projection. The
  three write call-sites forward the fields (`routes/api.js` POST/PUT `/streams`, `routes/backup.js`
  import). Public `GET /api/settings` now projects `codec` (player derives the extension). Backup
  round-trip: `lib/backup.js` `pickStreamFields` carries codec/bitrate_kbps/bit_depth; a pre-feature
  backup imports as the mp3 default. OpenAPI `spec.js`: StreamInput/Stream + SettingsEntry +
  selection-export `ext` documented. api node:test 177 → 204 (new `streams-quality-schema.test.js` +
  extended validate-stream/streams-service/streams-routes/settings-routes/backup/backup-routes suites),
  verified green in node:26-bookworm.
- **FEAT-002 — recorder/worker/api de-`.mp3`-ification (DONE, committed).** New pure
  `src/recorder/encoding.js`: `resolveEncoding(row)` clamps an unrecognised/NULL codec to the
  behaviour-preserving mp3@160 default (and reports `clamped`) and returns `{codec,ext,bitrate_kbps,
  bit_depth}`; `outputOptionsFor(enc)` returns the ffmpeg OUTPUT option **ARRAY** (never a shell
  string — NFR-3): mp3 `-c:a libmp3lame -b:a <n>k -ar 44100`, opus `-c:a libopus -b:a <n>k -ar 48000`
  (libopus rejects 44100 — see the integration note below), flac `-c:a flac -ar 44100` + `-sample_fmt
  s16` (16-bit) / `-sample_fmt s32 -bits_per_raw_sample 24`
  (24-bit). `ext === codec`. `Dockerfile.recorder` gains the MANDATORY `COPY src/recorder/encoding.js
  ./` (the recorder image copies by name; built + boot-required-module confirmed). `backoff-helpers.js`
  `segmentOutputName(folder,stamp,attempt,ext='mp3')` builds `.<ext>` / `.partN.<ext>`. `recorder.js`
  `recordStream(item,…)`/`superviseStream` resolve the per-stream encoding, build the output name with
  the resolved ext, apply the output-option array (replacing the fixed `.audioBitrate('160k')`, keeping
  `.audioFrequency(44100)`), probe `hasCurrentHourRecording(folder,stamp,ext)` with the resolved ext,
  and log a greppable `recorder: unknown codec <x> for <folder>, falling back to mp3` on a clamp;
  hourly cron + startup catch-up + 30s new-stream poll + per-stream supervision/backoff + `.partN` +
  graceful shutdown all preserved. `streams-db.js readStreams()` selects codec/bitrate_kbps/bit_depth;
  `recordings-db.js upsertRecordingStart({folder,stamp,ext='mp3'})` builds the real-ext file_path.
  Worker + api parsers widened to `(mp3|opus|flac)` and return `ext` (`worker/filename-utils.js`
  `parseRecordingParts` requires a real ext for the three production callers, keeps a bare-key
  `allowMissingExt` affordance returning `ext:null`; `api/lib/recording-name.js parseRecordingFilename`
  returns `{folder,date,hour,part,ext}`). Worker `AUDIO_EXTS={.mp3,.opus,.flac}` in peakfilegenerator
  (peak `<base>.json` derived from the real ext; passes `ext` into `upsertRecordingMeta`) and reconcile
  `scanAudioTree`; cleaner needs no delete-walk change (the widened parser handles row-match).
  `worker/recordings-db.js upsertRecordingMeta` (Site A, peakgen INSERT) gained an `ext` param
  (default 'mp3'); `upsertRecordingRow`/`updateRecordingRow` (Site B, reconcile) UNCHANGED. api
  `services/browse.js folderContent` lists `.mp3/.opus/.flac` hours; `routes/util.js
  POST /util/selection-export` gained an optional `ext` validated `^(mp3|opus|flac)$` (default 'mp3',
  bad ext → 400) used for the source path + temp output, keeping the existing re-encode trim.
  recorder node:test 53 / worker node:test 56 / api node:test 211 green in node:26-bookworm;
  `docker build -f Dockerfile.recorder` succeeds.
- **FEAT-003 — frontend player extension + admin codec/bitrate/bit-depth controls (DONE, committed).**
  `src/frontend/src/api.ts`: new `Codec` union (`mp3|opus|flac`); `codec` on the public `Stream`,
  `codec`/`bitrate_kbps`/`bit_depth` on `StreamRecord` + `StreamInput`; `audioMp3Url(...)` renamed to
  `audioUrl(folder,y,m,d,h,ext)` (single caller, no alias); optional `ext` on `SelectionExportBody`.
  `src/frontend/src/App.tsx` derives `selectedCodec` from the selected stream and uses it for the
  player URL (`audioUrl`), the WaveSurfer load, the `Download uur` filename, the selection-export
  `ext`, and the `Leuk fragmentje.<ext>` fragment download — the peaks `<base>.json` URL is
  unchanged. `src/frontend/src/useWavesurfer.ts` renames the `mp3Url` param to `audioUrl` (cosmetic).
  `src/frontend/src/settings/StreamTable.tsx` adds a `CODEC_OPTIONS` table mirroring the api
  allowlist, a codec `<select>`, and conditional Bitrate (lossy mp3/opus) / Bit-depth (lossless flac)
  `<select>`s; switching codec resets the dependent field to the codec's first valid value and clears
  the irrelevant one, so the form can never submit an invalid combo (AC-10); `EMPTY_FORM` defaults to
  the behaviour-preserving mp3@160. frontend vitest 37 → 41 (new App non-mp3 opus/flac player-load
  tests + StreamTable codec-control tests) and `tsc -b && vite build` green in node:26-bookworm.

### `stream-ordering` — MERGED + PUSHED (item 17: manual stream ordering + default stream + country-grouped admin view; ADDITIVE schema change; fast-forward merged into main AND pushed to origin/main)
Isolated git worktree at `.worktrees/stream-ordering` on branch `stream-ordering`. Task artifacts
under `.agents/tasks/stream-ordering-2026-10-23/` (context.json + features/FEAT-001..002.json).
Scope is `src/api/` + `src/frontend/` only — no recorder/worker/compose/nginx edits, no change to
`PRAGMA journal_mode` (stays DELETE), and the schema change is ADDITIVE ONLY.
- **FEAT-001 — backend (committed).** `db/schema.js` adds `sort_order INTEGER` to the streams DDL
  plus a guarded `migrateStreamsSortOrder(db)` (reads `PRAGMA table_info(streams)`, runs
  `ALTER TABLE streams ADD COLUMN sort_order INTEGER` + backfill `sort_order=id` only when absent;
  idempotent; establishes the first ALTER/migration pattern in the codebase). `services/streams.js`
  orders reads by `sort_order IS NULL, sort_order, id`, appends new rows with the next sort_order,
  and adds `reorderStreams(orderedIds)` + `ReorderMismatchError` (transactional index-based reassign).
  `routes/api.js` adds `PUT /api/streams/reorder` (requireAuth, registered BEFORE `/:id`), extends
  public `GET /api/app-config/public` with `default_stream_folder` (default ''), and adds
  `PUT /api/app-config/default-stream` (requireAuth, folder-existence validated). `app-config.js`
  gains a `default_stream_folder` validateConfig branch (any string incl. ''; rejects non-strings).
  Documented in `openapi/spec.js`. api node:test 158 → 177.
- **FEAT-002 — frontend (committed).** `api.ts`: `StreamRecord.sort_order`, clients
  `reorderStreams(order)` + `setDefaultStream(folder)`, and `getPublicConfig()` extended to
  `{title, default_stream_folder}`. `settings/StreamTable.tsx`: list GROUPED BY COUNTRY (one
  `<tbody>` per country with a `.settings-group-header`, countryName header, first-appearance order,
  rows in backend sort_order), per-row ▲/▼ buttons that reorder across the GLOBAL flat id sequence
  (swap-with-neighbour → `reorderStreams` → refresh; ends disabled), and a per-row 'Set default'
  button + `.settings-default-badge` 'Default' marker (the column header is 'Default stream' to avoid
  colliding with the badge). `App.tsx`: exported pure `pickInitialFolder(streams, defaultFolder)` and
  a best-effort `getPublicConfig()` fetch in the settings effect so the player preselects the default
  stream (falls back to the first stream) for anonymous users. Minimal CSS in `App.css`. frontend
  vitest 26 → 37; App default-selection tested BOTH via a full jsdom App render AND the pure
  `pickInitialFolder` unit tests. Verified in node:26-bookworm:
  `npm ci && npm test -- --run && npm run build` green (exit 0).
MERGE (2026-10-23): semantic review APPROVED (one non-blocking `sort_order` TS-type note — the
frontend `StreamRecord.sort_order: number` is slightly looser than the backend's nullable column, but
the migration backfills every row and `createStream` always assigns, so admin reads never return null;
accepted as-is). Fast checks re-run green in node:26-bookworm (api 177, frontend 37, build exit 0). The
rebase onto `main` (tip d7b1ed8) was a no-op — `stream-ordering` was already two commits on that tip —
so `main` was fast-forwarded to `stream-ordering` (the two FEAT commits == 88fbf71), this living-doc
update was committed on top (main == 9f1cec8), and `main` was pushed to origin (origin/main ==
9f1cec8, a clean fast-forward — no force-push).

### `stream-url-validation` — IN REVIEW (item 14: NON-BLOCKING "Test" stream-URL reachability probe; NO schema change)
Isolated git worktree at `.worktrees/stream-url-validation` on branch `stream-url-validation`.
Plan: `.agents/tasks/stream-url-validation-2026-10-23/plan.md`; verification evidence:
`.agents/tasks/stream-url-validation-2026-10-23/verification.md`. Scope is `src/api/` + `src/frontend/`
only — no recorder/worker/compose/nginx/schema/journal_mode edits.
- **Probe helper** `src/api/lib/probe-stream-url.js`: `probeStreamUrl(url, {request, now})` +
  the pure `classifyResponse({status, headers})` + `ProbeInputError`. Re-runs the EXISTING
  `validateUrl` (http(s) only) first, then probes via built-in node:http/node:https (NO ffprobe, NO
  child process, NO shell — the untrusted URL goes through `new URL()` + native request options, never
  a command string), hard 6 s timeout, ≤3 http(s)-only redirect hops, headers-only read. Classifies
  2xx+audio/ICY/HLS → reachable; non-2xx / non-audio / DNS / timeout → reachable:false + short detail.
  INJECTABLE `request` seam → unit-tested with a fake (no real network).
- **Endpoint** `POST /api/streams/test-url` (requireAuth) in `routes/api.js`: `ProbeInputError → 400
  {field:'url'}`; any other throw → 200 `{reachable:false, detail:'probe failed'}` (never 500 for the
  advisory helper). create/update/delete + the format gate UNCHANGED. Documented in `openapi/spec.js`
  (StreamTestUrlInput + StreamTestResult).
- **Frontend** `src/frontend/src/settings/StreamTable.tsx`: a `type="button"` "Test" button beside the
  URL field (never submits, disabled while probing / url empty) + an `aria-live="polite"` `role=status`
  region rendering green "Reachable" / red "Not reachable: <detail>". Clears on url change / resetForm
  / startEdit. Typed `testStreamUrl()` + `StreamTestResult` added to `api.ts`. The probe NEVER saves
  and NEVER gates the save path.
- **Tests:** api node:test 158 (new `probe-stream-url.test.js` classifier/mapping with a fake request:
  2xx+audio/ICY/HLS reachable, non-audio/404/ENOTFOUND/timeout not reachable, redirect chain, non-
  http(s) redirect, too-many-redirects, malformed + `file:` → ProbeInputError with transport asserted
  NOT called; `test-url-route.test.js` 401 anon / reachable / not-reachable / 400 ProbeInputError /
  advisory-throw). frontend 26 vitest (StreamTable.test.tsx +3: Test→Reachable, Test→Not reachable,
  Test-is-non-submit / no createStream, api.ts client MOCKED). Verified in node:26-bookworm: api green,
  frontend vitest + `tsc -b && vite build` green.

### `stream-health-redesign` — DONE + MERGED to main (== b06db8b) + pushed (item 21 v2: two-signal health model; READ-ONLY, NO schema change)
Built on branch `stream-health-redesign` (based on main == 580ad18), review APPROVED, fast-forward
merged into `main` and pushed to origin. Plan: `.agents/tasks/plan.md`. The first version (merged to main) showed almost
every stream "degraded" / "0 streams OK" even with the recorder running fine. Two root causes: (1) the
health route computes the current hour-slot via ambient `getHours()` (UTC when the API process is not
Amsterdam) while the recorder stamps slots in `Europe/Amsterdam` local time — a 1–2h offset makes the
in-progress/just-finished hour read as "missing"; (2) the `ok/degraded/down/never` model is driven by a
24h missing-hour gap count, so any recent gap marks a stream unhealthy. The user re-specified a
TWO-SIGNAL design: a **Now** column (green check = the CURRENT Amsterdam hour-slot has a `recording`
row, the ONLY thing that drives the check; no gap count may affect it) and a separate informational
**Last 24h** column (a short gap summary — "complete" or "N gaps: HH:00, …", current hour excluded).
Fix the TZ by computing Amsterdam Y-M-D-HH with `Intl.DateTimeFormat(timeZone:'Europe/Amsterdam',
hourCycle:'h23')` (DST-safe, never a hardcoded +2). Reshape `deriveStreamHealth` to
`{recordingNow, last24h:{complete,gapCount,gaps[]}}` + a `{total,recordingNow,notRecording}` roll-up;
update `openapi/spec.js` + `api.ts` to the new shape; rework `StreamHealth.tsx` into the two-column
table. Tests: two-signal helper cases, a route-level Amsterdam-timezone regression test, two-column
frontend tests. Scope is `src/api/` + `src/frontend/` only — no recorder/worker/compose/nginx/schema
edits. Confirmed recorder status values (from `src/recorder/recordings-db.js`): `recording` on start,
`partial` on mid-hour restart, `complete` on finalize. DONE (merged to main, pushed): pure two-signal `deriveStreamHealth`
(`{recordingNow, last24h:{complete,gapCount,gaps[]}, lastSlotStatus}`) with a
`{total,recordingNow,notRecording}` roll-up; new pure `src/api/lib/amsterdam-slot.js` computing the
Amsterdam slot via `Intl.DateTimeFormat(timeZone:'Europe/Amsterdam', hourCycle:'h23')` (route now uses
it instead of ambient `getHours()`); `openapi/spec.js` + `api.ts` reshaped; `StreamHealth.tsx` is now a
two-column (Now check + Last-24h summary) table. Tests green in node:26-bookworm — api 212 node:test
(incl. two-signal helper cases + an Amsterdam-vs-UTC route regression) and frontend 42 vitest + clean
`tsc -b && vite build`. Evidence: `.agents/tasks/verification.md`.

### `stream-health` — SUPERSEDED by `stream-health-redesign` (item 21 v1: admin "which streams are NOT working" health panel; READ-ONLY, derived from existing recordings rows, NO schema change)
Isolated git worktree at `.worktrees/stream-health` on branch `stream-health` (based on main == 6d865f1).
Plan: `.agents/tasks/audiostreamlogger-stream-health-2026-10-23/plan.md`; verification evidence:
`.agents/tasks/audiostreamlogger-stream-health-2026-10-23/verification.md`. Scope is `src/api/` +
`src/frontend/` only — no recorder/worker/compose/nginx/schema edits, no new table, no writes.
- **Pure helper** `src/api/services/stream-health.js`: `deriveStreamHealth({streams, rows, currentSlot,
  windowHours})` classifies each stream `ok|degraded|down|never` over the last `windowHours` (default 24)
  slots, returning `{folder, name, status, lastSuccessfulSlot, consecutiveMissing, expectedInWindow,
  presentInWindow}`. PURE (injected `currentSlot`, no DB/fs/clock) so it is unit-tested without a DB;
  the current in-progress hour is graced (never a failure). `summarizeHealth` rolls up the counts.
- **Endpoint** `GET /api/analysis/stream-health?windowHours=N` (requireAuth) in `routes/analysis.js`:
  reads the server clock once for the local `currentSlot`, fetches recent rows via the new cross-folder
  `recordings.listRecentByDate(start, end)`, joins `listStreams()`, and returns
  `{window_hours, generated_slot, unhealthy_count, counts, streams[]}`. `windowHours` validated to an
  int in [1,168] (400 `{field:'windowHours'}`). Documented in `openapi/spec.js` (StreamHealthResponse).
- **never-vs-down distinction (review fix):** the route also passes the helper an ALL-TIME
  last-complete signal from the new `recordings.latestCompleteByFolder()` (`MAX(date||'-'||hour)` over
  every complete row, window-independent). So `never` means "no complete recording EVER", and a stream
  that recorded before but has nothing good in the window classifies `down` (not `never`) even though
  `listRecentByDate` returns zero in-window rows for it.
- **Frontend** `src/frontend/src/settings/StreamHealth.tsx` (rendered in SettingsPage between
  WorkerStatus and RecordingsAnalysis): problem streams (down→degraded→never) listed first with their
  symptom — status badge, consecutive-missing count, last successful hour (or "no recordings yet");
  healthy streams summarised ("N streams OK"). Loading + ApiError states mirror WorkerStatus. Typed
  client `getStreamHealth()` + interfaces added to `api.ts`.
- **Tests:** api node:test 140 (new `stream-health.test.js` pure-helper cases: ok/down (empty
  in-window rows + injected all-time signal)/degraded/never/consecutive-missing/current-hour grace +
  `analysis-routes.test.js` route cases: 401, windowHours 400s, authenticated shape with an ok, a
  never, AND a long-stopped `down` stream); frontend vitest 23 (new `StreamHealth.test.tsx`: problem
  ordering + symptoms, all-ok summary, error alert).

### `testing-ci` — MERGED + PUSHED (CHUNK E: testing strategy + CI + dependency automation + architecture docs; tests/config/docs ONLY, NO runtime behavior change; fast-forward merged into main AND pushed to origin/main, main == testing-ci == bad6177)
Isolated git worktree at `.worktrees/testing-ci` on branch `testing-ci`. Plan:
`.agents/tasks/audiostreamlogger-testing-ci-2026-10-23/plan.md`; verification evidence:
`.agents/tasks/audiostreamlogger-testing-ci-2026-10-23/verification.md`. Scope is deliberately tests
+ `.github/` config + docs + one test-only devDependency — no service source under `src/*/` (outside
`test/`) changed, and no runtime dependency added.
- **API integration tests** (ephemeral `node:http` server + `fetch`, no supertest — reuses the
  temp-DB require.cache injection pattern from `jobs-routes.test.js`). Five new suites:
  `auth-routes` (real express-session + the hand-rolled `SqliteSessionStore`: login sets cookie,
  `/auth/me`, logout invalidates, wrong-password 401, change-password happy/wrong-current/anon),
  `streams-routes` (CRUD behind requireAuth, 401 anon, validation 400 `{field}`, duplicate 409,
  unknown id 404), `settings-routes` (public `/api/settings` + `/api/settings2`, no session),
  `backup-routes` (export/import 401 anon; export = streams + safe config only, NEVER users/sessions;
  import upsert-by-folder + safe config), `analysis-routes` (summary + gaps auth + validation +
  shape). api node:test 83 → 114.
- **Frontend tests** (vitest/jsdom): `SettingsPage.test.tsx` (login form when `/auth/me` anonymous,
  management UI when authenticated — permissive fetch stub + EventSource stub) and
  `StreamTable.test.tsx` (renders a row per stream; add-form submit calls `createStream` with the
  entered fields — `../api` mocked). No standalone wavesurfer-control test: WaveSurfer is mocked
  wherever it is on the render path (cannot decode audio under jsdom), noted in docs/TESTING.md.
  frontend vitest 16 → 20.
- **Coverage (report-only, NO failing threshold yet):** `test:coverage` scripts on all four services
  (`node --test --experimental-test-coverage` backend; `vitest run --coverage` frontend). Added the
  only new dependency — the test-only `@vitest/coverage-v8@^2.1.8` devDep in `src/frontend` — and
  regenerated `src/frontend/package-lock.json` so `npm ci` still passes. `vitest.config.ts` gets a
  v8 coverage block (text + lcov reporters).
- **CI:** `.github/workflows/ci.yml` on push + pull_request — a `backend` matrix over
  `[api, worker, recorder]` on Node 26 (`npm ci` + `npm test` + non-blocking coverage, `SESSION_SECRET`
  dummy env), a `frontend` job (`npm ci` + build + vitest + non-blocking coverage), and a
  `docker-build` job (`docker compose config` + `docker compose build` of all four). Every `run:`
  mirrors a command proven locally/in-container.
- **Dependabot:** `.github/dependabot.yml` (v2) — `npm` per service dir, `docker` for the four root
  Dockerfiles (base-image bumps: `node:26-bookworm`/`nginx:1.27-bookworm`; a major `26`→`27` surfaces
  as a PR to review), and `github-actions`; weekly, grouped minor/patch, modest PR limits.
- **Docs:** new `ARCHITECTURE.md` (four services + how they fit, config-in-DB, run/test, data volume +
  backup) and `docs/TESTING.md` (unit-vs-integration, where tests live, the node:http-not-supertest
  choice, how to run locally + in CI, report-only coverage intent); `README.md` links both.
VERIFIED in node:26-bookworm (host has no node): api 114 / worker 37 / recorder 35 node:test,
frontend build + 20 vitest, `npm ci` exit 0 per service with the updated lockfile, `docker compose
build` for all four, YAML lint of ci.yml + dependabot.yml, and a cold-data smoke on an ALTERNATE
port/project (PORT=9789, `-p asl-testing`, volumes redirected to a throwaway /tmp dir) — all four
services healthy, login works, `/api/settings` 200, torn down with `down` (no `-v`), temp dir removed,
the worktree `./data` stayed cold, and 9703 was never bound. The GitHub-hosted workflow cannot be
executed from here (stated in verification.md). MERGE (2026-10-23): the Chunk E work was committed on
`testing-ci` (commit bad6177), the rebase onto `main` was a no-op (testing-ci was already one commit
on the current `main` tip 23bc181), `main` was fast-forwarded to `testing-ci` (main == testing-ci ==
bad6177) and PUSHED to origin/main, and `testing-ci` was pushed to origin with upstream tracking.

### `code-quality` — MERGED + PUSHED (CHUNK D: worker/API code-quality sweep coded + verified + review APPROVED, rebased onto main tip and fast-forward merged into main AND pushed to origin/main)
Isolated git worktree at `.worktrees/code-quality` on branch `code-quality`. Plan:
`.agents/tasks/plan.md`; verification evidence: `.agents/tasks/verification.md`. Behavior-preserving
sweep plus two small LOW fixes:
- worker peakfilegenerator `execSync` (shell-interpolated paths) → `execFileSync` with array args via
  a pure `exec-args.js` builder (unit-tested); no other worker `child_process` use exists.
- a tiny dependency-free `log` helper (ISO timestamp + level) per service (`src/api/lib/log.js`,
  `src/worker/log.js`, `src/recorder/log.js`, identical copies, unit-tested once) adopted at the
  services' own log lines.
- all four `package-lock.json` in sync (api + worker newly created) and every Dockerfile switched
  from `npm install` to `npm ci` (added the missing `COPY src/recorder/log.js`).
- real `package.json` metadata (recorder `author: "Your Name"` removed; description/license on
  recorder/api/worker).
- the configured app_title now applied on `/settings` too via a shared `useAppTitle` hook.
Already-resolved items deliberately skipped (no no-op edits): the global `express.json({limit})`
and the recorder gap/error logging (Chunk B). Verified in node:26-bookworm: api 83 / worker 37 /
recorder 35 node:test, frontend build + 16 vitest, `npm ci` exit 0 per service, `docker compose
build` for all four, and a cold-data smoke on an alternate port/project confirming healthy services,
login, public settings endpoints, the settings title, and a peakfilegenerator job generating a real
peak file at runtime.
REVIEW + MERGE (2026-10-23): semantic review APPROVED — gate
`.agents/tasks/audiostreamlogger-code-quality-2026-10-23/review.json` `verdict=APPROVED`, no
blocking findings (two NON-blocking NITs: operational log lines now carry an ISO timestamp + level
prefix — a user-visible format delta IF log text is treated as a contract, but the greppable
recorder supervision lines keep their exact text so Chunk B grep patterns still match; and the `log`
helper is intentionally duplicated byte-for-byte across `src/api/lib/log.js`, `src/worker/log.js`
and `src/recorder/log.js` because each service is a separate Docker build context — divergence risk
low, documented in each file header, unit-tested once). Since `code-quality` was already a single
commit on the current `main` tip (f4b0314) the rebase was a no-op; `main` was fast-forwarded to
`code-quality` (main == code-quality == 3d779fc) and PUSHED to origin/main, and `code-quality` was
pushed to origin with upstream tracking.

### `admin-config` — MERGED + PUSHED (CHUNK A: all 3 FEATs DONE + INTEGRATION VERIFIED + review APPROVED, rebased onto main tip and fast-forward merged into main AND pushed to origin/main)
Status: isolated git worktree branched off `main` (base commit 9e31b3a) at
`.worktrees/admin-config` on branch `admin-config`. Implementation plan authored at
`.agents/tasks/admin-config-2026-10-23/plan.md` and the work decomposed into three
dependency-ordered FEATs (task.json + context.json + features/FEAT-001..003.json); the workflow
tail was restructured into one coder step per FEAT + a fixer/reviewer convergence loop
(gate `.agents/tasks/admin-config-2026-10-23/review.json`, `verdict` → `APPROVED`) + a merge step.
Chunk A delivers five admin-screen / DB-config features, all reusing the existing `app_config`
store, `requireAuth`, the `api.ts` typed clients, and the `node:sqlite` handle (no new config store,
no new native dep):
- FEAT-001 — editable page title (app_config `app_title`, default "Dé radiologger"; public
  `GET /api/app-config/public`, auth'd `PUT /api/app-config/title`; frontend sets `document.title`
  at runtime) + editable favicon (binary upload stored as a FILE under `./data/branding/` with a DB
  reference `favicon_path`/`favicon_mime`; auth'd raw-body upload with png/ico/svg + ≤1 MiB
  validation; public `GET /api/branding/favicon` streams the stored file or a bundled default;
  `<link rel=icon>` added to index.html).
- FEAT-002 — worker status in the admin screen (the worker UPSERTs `worker_last_heartbeat`/
  `worker_status`/`worker_current_job_id` into `app_config` over its RW handle on its existing 5 s
  timer; auth'd `GET /api/worker/status` joins the current job id to the jobs row) + player
  hour-selector limited to hours that actually exist, derived from the public `/api/settings2`
  browse tree (still works anonymously). IMPLEMENTED + VERIFIED on `admin-config` (worker
  `writeWorkerStatus` best-effort upsert + 5 s timer, `GET /api/worker/status` requireAuth,
  `WorkerStatus.tsx` admin panel, pure `player-hours.ts` helpers wired into `App.tsx`'s hour
  selector; app_config validateConfig gained worker_* passthrough branches). Tests: worker
  `worker-status.test.js` (4) + frontend `player-hours.test.ts` (5); api 60 / worker 15 /
  frontend 14 green, `npm run build` + `docker compose build api worker frontend` green.
- FEAT-003 — DB backup/export + import from the admin screen. IMPLEMENTED + VERIFIED on
  `admin-config` (commit df303d1): pure `src/api/lib/backup.js` (`buildBackup`/`validateBackup`/
  `pickSafeConfig` + `SAFE_CONFIG_KEYS` allowlist), new `src/api/routes/backup.js` mounted at
  `app.use('/api/backup', ...)` — auth'd `GET /export` (JSON streams + safe `app_config`),
  `GET /db` (raw `app.db` octet-stream, 404 if missing), `POST /import` (route-local
  `express.json({limit:'5mb'})`, upsert streams by folder via the SAME `validateStream`, apply ONLY
  allowlisted config keys, NEVER users/sessions/jobs/schedules; returns imported/updated/skipped/
  config_applied/config_skipped). `getStreamByFolder` added to `services/streams.js`. Frontend
  `BackupSettings.tsx` (download JSON / download raw db / import-with-summary) mounted in
  SettingsPage. Tests: `src/api/test/backup.test.js` (9).
Pure logic extracted for tests: favicon type/size validation, backup JSON shape/validation/scoping,
existing-hours derivation. Runs in parallel with other work without touching `main` until the merge
step. PROGRESS: ALL THREE FEATs (FEAT-001 title+favicon, FEAT-002 worker status+existing-hours
selector, FEAT-003 DB backup/import) are implemented, tested and committed on `admin-config`. The
full cross-FEAT INTEGRATION verification PASSED iteration 1 with NO code fixes — api 69 / worker 15
node:test green, frontend `npm run build` + 14 vitest green, `docker compose build api worker
frontend` built all three images (all in node:26-bookworm; host has no node). Inter-feature seams
are clean: `validateConfig` carries one branch per key (branding + worker_* with no duplication),
`/api/branding` + `/api/backup` + `/api/jobs` each mounted once in `index.js`, the three features'
`api.ts` additions type-check together, SettingsPage mounts each admin section once, and nginx
`location /api/` already covers every new path.
REVIEW + MERGE (2026-10-23): semantic review APPROVED — gate
`.agents/tasks/admin-config-2026-10-23/review.json` `verdict=APPROVED`, no blocking findings (two
non-blocking NITs: no warning logged when a recorded `favicon_path` is missing on disk — the serve
route still fail-safes to the bundled default; and a mixed-validity backup import is not
all-or-nothing for `app_config` since each allowlisted key is applied/skipped individually — both
acceptable as-is). The fast checks were re-run green on the branch after rebase (api 69 / worker 15
node:test, frontend `npm run build` + 14 vitest, all in node:26-bookworm). The branch was rebased
onto the current `main` tip (0a3a386, which already carries `recorder-resilience`) — the only
rebase conflicts were in this living TODO doc and were resolved by hand — then `main` was
fast-forwarded to `admin-config` and pushed to origin/main.

### `recorder-resilience` — MERGED + PUSHED (CHUNK B: coded + tested + committed + semantic review APPROVED, fast-forward merged into main AND pushed to origin/main)
Status: isolated git worktree branched off `main` at `.worktrees/recorder-resilience` on branch
`recorder-resilience`. Runs in PARALLEL with `admin-config` (CHUNK A); scope is STRICTLY confined to
`src/recorder/` (recorder.js, its helper modules + tests, and `Dockerfile.recorder` for two COPY
lines) so the two branches cannot collide — admin-config owns api/worker/frontend/compose/schema.
Implementation plan authored at `.agents/tasks/audiostreamlogger-recorder-resilience-2026-10-23/plan.md`;
verification evidence at `.agents/tasks/audiostreamlogger-recorder-resilience-2026-10-23/verification.md`.
NOT decomposed into FEATs and the workflow tail is NOT restructured — the existing implement-and-review
loop runs the plan. Three recorder-only deliverables (all implemented), plus a scope addition:
- Per-stream ffmpeg process supervision (Option B): if one stream's ffmpeg dies/errors mid-hour,
  restart ONLY that stream with capped exponential backoff, within the current hour's window only;
  the hourly cron run and startup catch-up are preserved unchanged. DESIGN CHOICE: a mid-hour
  restart writes a NEW same-hour segment file (`<folder>-<stamp>.partN.mp3`) rather than appending,
  because ffmpeg cannot cleanly append to an mp3 — no overwrite, no data loss, the primary
  `<folder>-<stamp>.mp3` name is untouched.
- Graceful shutdown (recorder scope only): on SIGTERM/SIGINT, `command.kill('SIGTERM')` each ffmpeg
  so the mp3 is finalized (not truncated), stop the cron task + clear the hot-reschedule timer,
  close the read-only DB handle, exit 0. Worker/api shutdown stays out of scope.
- Per-stream gap/error logging: replace the swallowed `console.error` with clear greppable per-stream
  lines on ffmpeg error/exit/restart (conventional console logging, no logging framework) — closes
  the LOW "ffmpeg errors swallowed" debt.
- SCOPE ADDITION (user, 2026-10-23) — auto-start a newly-added stream for the remainder of the
  current hour. A stream added on the settings page (appears in the DB `streams` table) is now
  recorded immediately instead of waiting for the next hourly cron tick. MECHANISM: Option A, a
  recorder-only periodic DB poll (`NEW_STREAM_POLL_MS = 30s`) that re-reads the stream list over the
  existing read-only `node:sqlite` handle and reuses the EXACT startup catch-up path
  (`runCatchup` → `streamsNeedingCatchup` + the `exists=skip` check → `superviseStream`). This starts
  a brand-new stream right away, skips streams already recording/recorded this hour, is harmless for
  streams the cron already handles, is failure-isolated (try/catch per tick, retries next tick), its
  recordings are supervised/backed-off like any other, and its timer is cleared on SIGTERM/SIGINT.
  Option B (api pushes to the recorder) was rejected as out of this workflow's recorder-only scope.
Pure logic extracted for `node:test`: capped backoff-delay calculator + segment-name/within-hour
helpers in a new `src/recorder/backoff-helpers.js`, and the `streamsNeedingCatchup` selector in a new
`src/recorder/catchup-helpers.js`, both mirroring the `time-helpers.js` split. Verified in a throwaway
`node:26-bookworm` container (host has no Node): `node --check` on all five recorder JS files +
`node --test` for the recorder (existing suites stay green + the new backoff/catchup helper tests
pass — 28 tests total), `docker compose build recorder` (confirms the two new COPY lines), a built-image
`require()` smoke check, and a `git diff --name-only` scope check listing only `src/recorder/`
(+ `Dockerfile.recorder`). Committed on `recorder-resilience`, then fast-forward merged into `main`
(f348ccc..b293435, recorder files only) and pushed: `main` == `recorder-resilience` == b293435 on
origin/main, and `recorder-resilience` pushed to origin with upstream tracking.
REVIEW (2026-10-23): semantic review APPROVED — gate `.agents/tasks/audiostreamlogger-recorder-resilience-2026-10-23/review.json`
`verdict=APPROVED`, no blocking findings. All six requirement areas (per-stream supervision + bounded
backoff + current-hour segment behavior, graceful SIGTERM/SIGINT shutdown, per-stream greppable
logging, preservation of DB-minute read/hot-reschedule/catch-up/time-helpers/heartbeat/cron try-catch,
pure helpers + node:test, and strict `src/recorder/`-only scope) verified. Two NON-blocking findings
noted for later: (1) an early ffmpeg `end` with no `error` is not restarted (dropped inputs normally
surface as `error`, which IS restarted); (2) the 30s new-stream poll could re-select a just-started
stream if ffmpeg has not yet created its file within the window. Next: the merge step.

### `security-update` — MERGED INTO `main`
Status: done, APPROVED, rebased onto `main` and fast-forward merged. Worktree + branch cleaned up.
Commits on main: a13c97e, a141df3, ce89639.

What it contains:
- Dependencies bumped: express ^5.1.0, node-cron ^4.6.0, fluent-ffmpeg ^2.1.3, cors ^2.8.5.
- Removed bogus/builtin npm packages (fs, path, child-process, fs.promises, index.js)
  and unused auth libs (basic-auth, express-basic-auth).
- Dockerfile.peakfilegenerator rewritten to node:26-bookworm + audiowaveform 1.10.2
  via the official BBC .deb (dead ubuntu:20.04 + PPA removed). All services on node:26-bookworm.
- Root `.dockerignore` added; readme updated (docker-compose -> docker compose).
- Frontend security fixes:
  - /selection-export: path traversal closed (allowlist + path.resolve containment).
  - Temp-file leak fixed (os.tmpdir(), cleanup on all paths).
  - CORS off by default (only on with CORS_ORIGIN).
  - nginx autoindex off.
  - Port configurable via APP_PORT (compose ${PORT}:80 still works).

### `frontend-react` — MERGED INTO `main` (finalize done)
Status: new React + Vite + TS frontend implemented in `frontend-react/`, committed (10ffce3,
+ 9d57d33 task artifacts). Rebased onto `main` (already on the current `main` tip, so a no-op/no
conflicts) and `main` fast-forwarded to `frontend-react` (`main` == `frontend-react` == 9d57d33).
Legacy `frontend/` untouched, backend unchanged. NB: `security-update` was not yet merged, so the
expected compose/Dockerfile.frontend conflicts did not (yet) occur here. Semantic review gate
APPROVED (see .agents/tasks/review.md / review.json); no blocking findings.
- Wavesurfer v7 (7.12.12) + Regions kept; styling recovered from the old bundle:
  waveColor "violet", progressColor "purple", normalize true, other visuals at v7 defaults,
  regions via buttons at the playhead.
- flatpickr and lodash dropped (datetime becomes a native input).
- Functionality 1:1, Dutch labels, all control ids.
- Consumes existing APIs: /api/settings(2), /audio/..mp3 + .json peaks, POST /util/selection-export.
- Verified in node:20 container: npm install + build (dist/ produced) + test (1 passed), all exit 0.
- Non-blocking review findings (pick up later): selection download now fails silently
  (only console.error instead of a visible error like legacy); optional extras from the old
  bundle (right-click=pause, double-click=play, mouse-wheel=zoom) not yet implemented — NOTE:
  right-click/double-click have since been added (see item 6 note); mouse-wheel=zoom is now
  planned and in progress (see item 13). Smoke test only covers
  render, not the selection math/export flow.
- Finalized: `frontend-react` is now on `main`. Dev run: `cd src/frontend && npm install && npm run dev`.

---

### `techdebt-high` — MERGED INTO `main` + PUSHED
Status: done, APPROVED, fast-forward merged into `main` (`main` == `techdebt-high` == 5625599,
already based on the `main` tip fccedef so the rebase was a no-op). Worktree + branch cleaned up.
Commits on `main` (on fccedef): 7d967db, 446b46f, ff28ff3, f69df16, 5625599.
All five HIGH items are checked off (see the HIGH list at the bottom).

The HIGH technical-debt items were addressed here (see the HIGH list at the bottom).
The five items were split into four features: FEAT-001 (confirm api `/settings2` + transform
helper), FEAT-002 (peakfile regex guard + cleaner retention), FEAT-003 (crash resilience:
try/catch in cron, `restart: unless-stopped` + healthchecks, `/healthz`), FEAT-004 (minimal
`node:test` suite). Choice: per-service helpers instead of one shared module, to keep the Docker
COPY lines simple (the `validateMinute` duplication remains a deferred MEDIUM follow-up).

Progress summary (now on `main`):
- FEAT-002 DONE (worker correctness, HIGH items 2 and 4). New per-service helpers
  `src/peakfilegenerator/filename-utils.js` (`extractFileDateTime` -> match or `null`, no `[0]`
  on null) and `src/cleaner/settings-utils.js` (`validateMinute` 0..59 + `validateRetentionHours`
  1..8760). `peakfilegenerator.js` now skips `.mp3` files without a date pattern (log + `return`)
  instead of crashing the whole run. `deletefiles.js` accepts `log_retention` up to 8760h (168
  works now) and recomputes `thresholdTime` every cron run. `cleaner_minute` check deliberately
  kept at the old 1..59 bound.
- FEAT-003 DONE (crash resilience, HIGH item 3). Each cron callback in `recorder.js`,
  `deletefiles.js` and `peakfilegenerator.js` is now wrapped in try/catch that logs a greppable
  line and returns instead of crashing; the boot-config exits stay intact. All three workers write
  a `/tmp/heartbeat`. `src/api/index.js` has `GET /healthz`. `docker-compose.yml`:
  `restart: unless-stopped` on all five services + healthchecks (workers = heartbeat freshness,
  api = `node http /healthz`, frontend = `curl` on nginx root). `curl` added to stage 2 of
  `Dockerfile.frontend`.
- CROSS-FEAT INTEGRATION VERIFICATION DONE. All three `node:test` suites + `node --check` on the
  nine runtime/helper files passed in node:26-bookworm. Build of all five images OK; smoke-up had
  all five containers healthy and `/api/settings` -> 200. One seam fixed: the `/settings2` 500 on a
  fresh stack — `folderContent()` in `src/api/routes/api.js` now treats a not-yet-existing stream
  subfolder (ENOENT) as empty logs (`return {}`); other errors still propagate.
- FEAT-004 DONE (minimal backend test suite, HIGH item 5). Three `node:test`+`node:assert` suites
  on the pure helpers from FEAT-001/FEAT-002, no new dependency; `"test": "node --test"` added to
  the three `package.json`s. All suites exit 0 in node:26-bookworm.

---

## Agreed next steps

### 1. Merge order — DONE
- [x] `security-update` -> `main` (rebased, ff-merge, artifact conflicts resolved).
- [x] `frontend-react` -> `main` (ff-merge).
- [x] `techdebt-high` -> `main` (ff-merge; `main` == 5625599).
- [x] `docker compose build` on merged `main` builds all images cleanly.
- [x] Worktrees + temporary branches cleaned up; `.agents/` untracked and gitignored.
- [x] Pushed to `origin/main` (user approved push-after-merge).

### 2. Split the API layer off the frontend (cleanliness; API is only for the frontend)
Chosen end state (same-origin, no CORS needed). STATUS: IMPLEMENTED + VERIFIED + MERGED INTO `main`
via fast-forward (commit 687eafd). Verification report: `.agents/tasks/api-split-verification.md`.
- [x] Separate `api` service: pure Node + Express, own `api/package.json` (express + fluent-ffmpeg,
      no cors), `Dockerfile.api` on node:26-bookworm + ffmpeg. Route files moved to `api/routes/`
      as the single source (legacy `frontend/routes/` removed, no duplicate copy). Runs internally
      on 3000, not public. Mounts audio (rw) + settings.json (ro).
- [x] `frontend` service: multi-stage build — stage 1 (node:26-bookworm) `npm run build` of the
      React app, stage 2 (nginx:1.27-bookworm) serves `dist/`. Small production image, no npm/Node
      at runtime. Legacy single-container frontend (index.js + web/) removed.
- [x] nginx proxies `/api` and `/util` to `http://api:3000` -> browser sees one origin, no CORS.
      `/audio` served directly by nginx (autoindex off). `/logger` alias dropped (confirmed unused).
- [x] docker-compose.yml rewritten: new `api` service, rebuilt `frontend` service, both on
      `web-network`. recorder/cleaner/peakfilegenerator unchanged.
- [x] Included: the HIGH `/settings2` `.map` bug fixed as a one-liner (`JSON.parse(...).streams`).

### 3. "I just want to stay current" — dependency automation
- [x] Set up Renovate or Dependabot: automated PRs for both base images (node:XX / nginx:XX) and
      npm packages. This is the only way to keep both the image layer and the package layer current
      (bumping the image tag only covers OS+Node, not the npm deps).
      DONE on `testing-ci` (CHUNK E): `.github/dependabot.yml` (version 2) adds the `npm` ecosystem
      for each service dir (`/src/api`, `/src/worker`, `/src/recorder`, `/src/frontend`), the `docker`
      ecosystem for the four root Dockerfiles (base-image bumps — `node:26-bookworm`,
      `nginx:1.27-bookworm`, incl. a major `26`→`27` surfacing as a PR to review), and `github-actions`,
      all on a weekly schedule with grouped minor/patch bumps. See the `testing-ci` branch section below.

### 4. Clean up stale lockfiles (non-blocking nit from the security review)
- [x] package-lock.json files still pin old versions. Harmless now because the Dockerfiles use
      `npm install`, but it bites once you move to `npm ci`. Regenerate after the dependency bumps.
      Consider `npm ci` in the Dockerfiles afterwards for reproducible builds.
      DONE on `code-quality` (CHUNK D): regenerated/created all four lockfiles and moved every
      Dockerfile to `npm ci`; see the Technical-debt LOW item below for the full note and proof.

---

### 5. Settings screen with a database (DECIDED — user wants a settings screen with a DB)
Problem: `settings.json` currently mixes two kinds of config with different rhythms:
- Operational/infra: cron minutes (recorder_minute, cleaner_minute, peakfile_minute) + log_retention.
- Content/domain: the stream list (name, folder, url, country) — wants to manage easily.

DECIDED choices (user, 2026-10-23):
- Stream fields: KEEP ALL current settings.json fields on the stream record — country, name,
  folder, url. Do NOT drop any, even though the frontend does not use `country` yet (it will).
  The settings screen must allow adding/editing streams with all these fields.
- Country field: a dropdown with ALL countries per the ISO standard (ISO 3166-1), not a free-text
  field. DECIDED (user, 2026-10-23, Option 1): store the ISO 3166-1 alpha-2 code (e.g. "NL") and
  show the full country name in the dropdown. NOTE: existing data has the full name
  ("country":"Netherlands"), so moving to codes is a small one-time migration of that value.
- Cron + retention ALSO via the settings screen (NOT env-only). So this config goes into the DB,
  and the workers must be able to reload the values without a restart (recorder reschedules its
  cron on change). Deliberately chosen complexity. (NOTE: superseded for cleaner/peakfilegenerator
  by the job-queue/worker consolidation — see item 10 — but retention stays a DB-managed setting.)
- Session lifetime: conventional default (e.g. 7 days, httpOnly cookie).
- Write-path validation: YES — folder allowlist (^[a-z0-9_-]+$) + path.resolve containment, since
  folder becomes user input via the screen.
- Graceful shutdown: clean cutoff — SIGTERM/SIGINT handler shuts a running ffmpeg down cleanly.
  (Touches recorder.js; plan relative to recorder-catchup + settings-db.)
- Logging: realtime log pane in the admin/settings screen (stream logs to the frontend, e.g. via
  Server-Sent Events). Conventional, not-too-verbose logging; tune later.
- Push policy: I MAY push to origin/main after every successful merge (user approved).
- DB: SQLite on a persistent volume (./data/app.db bind-mount, survives rebuild). Postgres
  deliberately NOT (too much overhead for 1 admin + a handful of streams). Journal mode =
  `DELETE` (rollback journal), NOT WAL — so the read-only worker containers can open the `:ro`
  bind-mounted file without needing write access to a WAL `-shm` sidecar (design decision, settings-db-core).
- Hashing: Argon2id (npm `argon2`). Post-quantum deliberately NOT — PQC is about asymmetric crypto
  (RSA/ECC/Shor); password hashing is hash-based, Grover only halves the bit strength. Argon2id is
  the OWASP recommendation 2026. Post-quantum hashing is academic/overkill here.
- Seed: fresh boot => idempotent single admin user, username `admin` / password `admin`
  (Argon2id hash). NO env override (literally admin/admin, user's choice).
- `users` table (schema ready for multiple users), seeded with one admin now.
- Change-password in the settings screen (to get off admin/admin).
- Auth: httpOnly session cookie, built so it can later also protect MAIN-screen features (not just
  settings).
- Write endpoints (POST/PUT/DELETE /api/streams + auth) behind the wall; the public read endpoint
  /api/settings (selector) stays open.

SCOPE SHARPENING (user, 2026-10-23): settings.json must be COMPLETELY gone after this work.
Consequence — settings.json holds two things, both of which get a new home:
- Streams -> SQLite DB. The workers must also read from the DB instead of settings.json.
- Cron minutes + log_retention -> DB + settings screen (per the "cron/retention via UI" decision
  above; NOT env vars anymore).
- Remove the settings.json bind-mounts from all services in docker-compose.yml.

EXECUTION (broken into sequential, mergeable steps to keep recorder.js/compose conflicts small):
- [x] `settings-db-core` (step 1) — COMPLETE on branch `settings-db-core` (not yet merged):
  SQLite + Argon2id admin/admin + session cookie + stream CRUD + basic settings screen +
  write-path validation + API cleanup + .env.example.
  Streams move to the DB (workers read from the DB too). Cron/retention config STAYS in
  settings.json for this step. (branch settings-db-core, workflow wf_57ab8ef97967fddf)
  SCOPE ADDITION (user, 2026-10-23) [DONE in step 1]: kept all stream fields (country, name,
  folder, url) on the record and in the add/edit form — `country` kept even though the player
  doesn't use it yet. `country` is an ISO 3166-1 dropdown; stored as alpha-2 code (e.g. "NL") in
  `streams.country`, full name shown in the UI. Folder validation (^[a-z0-9_-]+$) and other field
  validation in place.
  - FEAT-005 (infra + docs wiring) DONE: nginx `/auth/` proxy block added alongside `/api/` +
    `/util/`; docker-compose mounts `./data` (api RW, recorder/cleaner/peakfilegenerator RO),
    passes `SESSION_SECRET`/`COOKIE_SECURE` to the api, frontend port defaults to `${PORT:-9703}`,
    recorder `depends_on` api `service_healthy` while cleaner/peakfilegenerator use plain
    `depends_on: [api]`; committed `.env.example`; README/TODO updated. settings.json bind mounts
    kept (cron/retention still read from it this step).
  - NOTE (DB foundation landed): `better-sqlite3` does NOT compile on node:26-bookworm (its
    native addon uses V8 APIs removed in Node 26), so the api DB handle uses Node's built-in
    `node:sqlite` (`DatabaseSync`) instead — no native build, same prepare/exec surface. `argon2`
    still compiles and is used for the admin hash. `better-sqlite3-session-store` was dropped too.
    DECIDED for step 2's auth wiring: implement a node:sqlite-backed server-side express-session
    store (Option A), so logout AND change-password can invalidate sessions server-side (keeps the
    revocable-session decision; no extra infra). Stateless cookies were rejected.
  - NOTE (frontend admin view landed): the `/settings` React view is in — a `window.location`
    path check in `main.tsx` (no router added) renders `SettingsPage` for `/settings` and the
    unchanged player elsewhere. Logged out shows a login form; logged in shows the stream CRUD
    table (country as an ISO 3166-1 `<select>`: option value = alpha-2 code, label = full name;
    read view maps code -> full name) plus a change-password form and logout. Typed
    `credentials:'same-origin'` client fns added to `api.ts` (`getAuthMe`/`postLogin`/`postLogout`/
    `changePassword`/`getStreams`/`createStream`/`updateStream`/`deleteStream`) with a `StreamRecord`
    type (id + timestamps) distinct from the public `Stream`. The frontend bundles its own copy of
    `iso-3166-1.json` (identical content to the api copy; keep in sync). Also fixed a stale
    pre-existing assertion in `App.test.tsx` (`dateTimeSelector` -> the actual `dateSelector`/
    `hourSelector`) so the Vitest suite is green; player behavior unchanged.
- [ ] step 2: cron + retention into the DB + settings-screen UI; workers reload without restart.
  This is where settings.json is fully removed.
- [ ] step 3: realtime log viewer in admin (SSE) + conventional logging in the services.
- [ ] step 4: graceful shutdown (clean cutoff) in the workers.
- [ ] step 5: small items — hour selector based on existing hours, finish the production-port review.

### 6. Recorder: catch-up recording on startup (DONE — merged into `main`)
Status: IMPLEMENTED on branch `recorder-catchup`, APPROVED, fast-forward merged into `main`
(`main` == `recorder-catchup` == c36d630). Pushed. Worktree + branch cleaned up.
Commit on `main`: c36d630 `feat(recorder): catch-up recording for current hour on startup`.
Implementation: new pure module `src/recorder/time-helpers.js` (`secondsUntilNextHour` +
`currentHourStamp` as single source of truth for filenames), `recordStream` got an optional
`durationSeconds=3600` param (default behavior identical to the old `'01:00:00'`), and an additive
startup catch-up block (outer + per-stream try/catch) that, after cron registration, checks per
stream whether a recording for the current hour exists and if not records the remainder. Stream/
settings reading deliberately LEFT UNTOUCHED (same settings.json path) to keep the settings-db
merge minimal. `node:test` suite `time-helpers.test.js` added (7/7).
- [x] Startup check per stream + record the remaining part of the hour.
- [x] Same try/catch resilience as the scheduled runs.
- Note: "exists = skip" also counts a half/corrupt file as existing (from an earlier crash); keep
  it simple for now, perfection touches graceful shutdown.

### 7. Tidy up .env handling (user wish, fold into/around the settings workflow)
- [x] Add `.env.example` (DOES go into git, with dummy values). The real `.env` stays gitignored
      (the `!.env.example` exception already exists in .gitignore). DONE in FEAT-005 (step 1):
      committed `.env.example` with `PORT`, `SESSION_SECRET`, `COOKIE_SECURE` + a commented,
      documented `# APP_PORT=3000`.
- [~] Review the frontend port for production: the missing-default part is DONE — compose now uses
      `${PORT:-9703}:80` so an unset PORT no longer breaks compose. TLS/HTTPS and a reverse proxy
      in front are still out of scope (deferred to step 5); `COOKIE_SECURE` is already plumbed
      through so enabling the Secure cookie flag under TLS is a config change, not a code change.

### 8. Hour selector based on existing hours + recordings in the DB for analysis (user wish)
Two parts, independent:

Quick win (frontend; can fold into the settings workflow or stand alone, NO DB needed):
- [x] The hour dropdown currently shows a hardcoded 00-23. Replace it with only the hours that
      actually exist for the chosen stream + day. That data is already in /settings2 (browse tree
      station -> year -> month -> day -> hours[]). Wire the selector to that instead of hardcoded.
      DONE on `admin-config` (FEAT-002): `App.tsx` fetches `getSettings2()` and derives the
      `#hourSelector` options via pure `player-hours.ts` helpers
      (`displayNameForFolder` + `existingHoursFor`, vitest-covered) while keeping the leading 'Uur'
      placeholder; the hardcoded HOURS constant is gone and it still works for anonymous users
      (/settings2 is public). The day picker was left unconstrained for now (noted as optional in
      the step).

Larger feature (AFTER the DB exists; separate later workflow) — DONE, review-APPROVED, and
fast-forward merged into `main` (NOT pushed) on branch `recordings-analysis` (CHUNK C), decomposed
into FEAT-001..004 under `.agents/tasks/audiostreamlogger-recordings-analysis-2026-10-23/`:
- [x] FEAT-001 (api foundation) DONE on `recordings-analysis`: `recordings` table + indexes in
      `src/api/db/schema.js` (one row per (stream_folder,date,hour) hour-slot, keyed on
      stream_folder TEXT — NOT a FK; status recording/complete/partial/missing; UNIQUE
      (stream_folder,date,hour) + idx_recordings_folder_date + idx_recordings_date). Pure
      filename parser `src/api/lib/recording-name.js` (`parseRecordingFilename` handling the
      primary + `.partN` convention). `src/api/services/recordings.js` — pure helpers
      (`expectedHourSlots`/`missingSlots`/`aggregateByStream`) + data-access (`upsertRecording`
      ON CONFLICT upsert, `listAll`/`listByStreamAndRange`/`summarize`). requireAuth analysis
      router `src/api/routes/analysis.js` (`GET /api/analysis/summary`, `GET /api/analysis/gaps`)
      mounted in `index.js`. One-time startup backfill `src/api/services/recordings-backfill.js`
      (pure `reconcilePlan` + `runBackfill`) wired into the guarded bootstrap after seedJobConfig.
      Three `node:test` files added; `cd src/api && node --test` green (83 tests) in
      node:26-bookworm. `GET /api/settings2` unchanged. Recorder/worker/frontend/compose
      deliberately untouched (owned by FEAT-002..004).
- [x] FEAT-002 (recorder writes recordings rows + compose RW flip) DONE on `recordings-analysis`:
      new scoped RW handle `src/recorder/recordings-db.js` mirroring `src/worker/db.js`
      (busy_timeout + bounded SQLITE_BUSY retry, NEVER journal_mode) exporting
      `upsertRecordingStart`/`markSegment`/`markComplete` (parse the `YYYY-MM-DD-HH` stamp into
      date+hour; start inserts `recording`+segment_count 1 with ON CONFLICT DO NOTHING; a mid-hour
      restart flips to `partial` with segment_count=attempt+1; a normal finalize sets size_bytes
      and `complete` but NEVER downgrades an already-`partial` hour). Wired into
      `src/recorder/recorder.js`: the RW handle opens once at module load (a not-ready DB only logs
      and leaves writes no-op), `superviseStream` writes the start row (attempt 0) / segment row
      (attempt>=1), and the non-intentional, non-shutdown ffmpeg `end` stats the mp3 and writes the
      complete row — every write best-effort/try-caught so it never throws into the ffmpeg
      callbacks. `docker-compose.yml` recorder `./data` mount flipped `:ro`→rw with an explanatory
      comment (mirrors the worker override); `Dockerfile.recorder` now COPYs `recordings-db.js`.
      New `src/recorder/recordings-db.test.js`; `cd src/recorder && node --test` green (35 tests,
      pre-existing suites included) in node:26-bookworm and `docker compose config` parses with the
      recorder data mount no longer read-only. api/worker/frontend untouched.
- [x] FEAT-003 (worker fills duration/size + cleaner removes the row) DONE on `recordings-analysis`:
      `src/worker/filename-utils.js` gained a pure `parseRecordingParts(name)` → `{stamp,part}`|null
      (primary=part 1, `.partN`=part N≥2, else null); new `src/worker/recordings-db.js` exports
      `upsertRecordingMeta`/`deleteRecordingByFile` (split the `YYYY-MM-DD-HH` stamp into date+hour,
      wrap writes in the existing `withBusyRetry`; meta UPDATEs an existing row's duration/size and
      bumps a `.partN` to `partial`/segment_count, or INSERTs a `complete`/`partial` row when none
      exists; delete removes the hour row). `src/worker/handlers/peakfilegenerator.js` now fills
      `duration_seconds` via ffprobe (overridable `probeDurationSeconds` export so tests stub it) +
      `size_bytes` via `fs.statSync` per processed file, with per-file metadata errors logged+counted
      and NEVER failing the job (current-hour skip unchanged). `src/worker/handlers/cleaner.js`
      deletes the matching recordings row when it unlinks a recording (folder = immediate parent dir;
      row-delete failure logged+counted, never fatal; new rows-removed counters). New tests
      (`recordings-meta.test.js`, `peakfilegenerator-meta.test.js`, `cleaner-rows.test.js` + parser
      cases in `filename-utils.test.js`); `cd src/worker && node --test` green (32 tests, pre-existing
      suites included) in node:26-bookworm. api/recorder/frontend untouched.
- [x] FEAT-004 (frontend analysis view) DONE on `recordings-analysis`: typed `getAnalysisSummary`/
      `getAnalysisGaps` clients + `AnalysisStreamSummary`/`AnalysisOverall`/`AnalysisSummary`/
      `AnalysisGaps` interfaces in `src/frontend/src/api.ts` (credentials:'same-origin' + the shared
      `toApiError`/`ApiError` plumbing; shapes mirror FEAT-001's `summarize()`/`routes/analysis.js`,
      incl. the nullable `avg_duration_seconds`/`earliest`/`latest` and `overall.stream_count`). New
      `src/frontend/src/settings/RecordingsAnalysis.tsx` renders a per-stream table (folder, total
      hours, human-readable storage, recording count, avg duration, earliest–latest range) plus a
      gaps/coverage panel (stream `<select>` + start/end date inputs + a "Check gaps" button → expected
      vs present counts, coverage %, and the missing hour-slot list); loading + ApiError states mirror
      `WorkerStatus.tsx`. Rendered in `SettingsPage.tsx` right after `<WorkerStatus />`. New vitest
      `RecordingsAnalysis.test.tsx` (mocks the api.ts clients) asserts the per-stream rows and the
      missing-slot list after submitting the gaps form. Verified in node:26-bookworm: `npm install &&
      npm run build` (tsc -b && vite build) green with no type errors and `npm test` 16/16 pass. No
      backend or public-player code touched.
- [x] CROSS-FEAT INTEGRATION VERIFICATION (iteration 1) DONE on `recordings-analysis`: ran every
      service's full suite together in node:26-bookworm (host has no node) — api 83/83, worker 32/32,
      recorder 35/35 node:test, frontend `npm run build` clean + 16/16 vitest — plus `docker compose
      config` parses with the recorder `./data` mount flipped to read-write (no `read_only`). Confirmed
      the FEAT seams line up: recorder/worker row writes match the api table/column names and the
      `(stream_folder,date,hour)` upsert shape, the `/api/analysis/summary`+`/gaps` JSON matches the
      frontend's typed clients, backfill and the live writers share the same hour-slot grain, and
      `GET /api/settings2` is untouched (routes/api.js + services/browse.js not in the branch diff).
      ONE FIX: `src/api/test/recordings-backfill.test.js` crashed at load because it required
      `services/recordings-backfill` (→ `services/recordings` → `../db`) without seeding the temp-DB
      `require.cache` injection, so `db/index.js` tried to open the real `/usr/src/app/data/app.db` and
      threw in the toolchain; added the same before/after temp-DB injection the sibling recordings
      tests use (test-only; `reconcilePlan` behavior unchanged). api now 83/83.
- [x] FINALIZE DONE: semantic review APPROVED (two LOW, non-blocking findings — no
      analysis route-integration test and a cosmetic `file_path` inconsistency across the three
      writers; see `review.json`). Final green re-check in node:26-bookworm (host has no node):
      api 83/83, worker 32/32, recorder 35/35 node:test, frontend `npm run build` clean + 16/16
      vitest, and `docker compose config` parses with the recorder `./data` mount read-write.
      Fast-forward merged into `main` (main == recordings-analysis == 835d515). NOT pushed.
- Touches all layers (recorder/worker/api/frontend); natural next step now the SQLite DB exists.
  Deliberately NOT in the first settings-DB workflow (already large).

### 10. Job queue for on-demand + scheduled cleaner/peakfilegenerator runs — MERGED INTO `main` + PUSHED (Option A)
Status: done, APPROVED (no findings — `.agents/tasks/job-queue-2026-10-23/review.json`),
fast-forward merged into `main` and pushed to origin/main (`main` == `job-queue` == 428a385,
over the previous tip 0bb6345). Commits on main: d17cb77, 5b34849, a7a8383, 87fc818, 576e33e,
4db6db1, 428a385. All six FEATs are checked off in the implementation-progress list below, and the
cross-FEAT integration + cold-data convergence smoke passed iteration 1 with no code fixes
(`.agents/tasks/job-queue-2026-10-23/verification.md`). The generic `worker` now replaces the
`cleaner` + `peakfilegenerator` containers, `settings.json` is gone, the DB-driven scheduler +
SSE live job view are live, and README.md reflects the four-service architecture.

AUTO-ADVANCE (CHUNK A): per the user's standing instruction to automatically start the next task
after a workflow finishes ("Kun je na deze workflow automatisch de volgende taak op de lijst
starten?"), this merge hands off to the next chunk on the restructured list, CHUNK A. The workflow
drives which concrete item CHUNK A maps to; the remaining open work it draws from lives in the
items below — settings-db steps 4–5 (graceful shutdown; small hour-selector/production-port items),
item 8's quick-win hour selector, and item 11's per-stream recorder supervision. This note only
records that the auto-advance is expected; it does not re-scope those items.

User wants to trigger the cleaner and peakfilegenerator from the browser, and to schedule them.
Chosen approach (Option A, brainstormed 2026-10-23): a lightweight `jobs` table in the SQLite DB
(NOT a real message queue like Redis/BullMQ — overkill for this project, same reasoning as SQLite
over Postgres). The api writes job rows; the workers poll the table and execute.

DECIDED:
- A `jobs` table in SQLite: type (cleaner | peakfilegenerator | ...), status (pending/running/
  done/failed), params (optional), created/started/finished timestamps, output/log reference.
- MANUAL trigger from the admin screen ("run cleaner now" / "generate peak files now").
- SCHEDULER configurable in the browser: per job type an hourly / daily / weekly schedule. The
  schedule config lives in the DB; a light scheduler (in the api or a worker) reads the schedules
  and enqueues a job at the right time.
- Workers poll the `jobs` table (every few seconds) and execute pending jobs.
- PROGRESS visible in the UI (job status + a slice of output) — ties into the realtime log viewer
  (settings-db step 3).
- GLOBAL single-job limit: at most ONE job running at a time across ALL types.

DECIDED (user, 2026-10-23):
- Busy behavior: SKIP. If a scheduled/manual job wants to start while another is running, skip it
  and log "skipped, busy" (do NOT queue it). Simple; periodic jobs come around again anyway.
- This job scheduler REPLACES the current per-worker cron minutes entirely. Architecture shift:
  the separate `cleaner` and `peakfilegenerator` CONTAINERS go away; instead ONE generic `worker`
  service polls the `jobs` table and runs both job types (scheduled + manual). The cron-minute
  config and those two cron containers are removed.
  - ASSUMPTION (confirm): the `recorder` stays its OWN service — continuous/hourly recording is not
    an on-demand batch job, so it does not fold into the worker. Only cleaner + peakfilegenerator
    become worker job types.
  - CONSEQUENCE: this SUPERSEDES the planned settings-db "step 2" (cron/retention -> DB + screen).
    No point moving cron minutes into a DB setting and then deleting the containers. So the
    cron/retention migration and the worker/job-queue consolidation become ONE step, after the DB
    foundation (settings-db-core). Retention (log_retention) still becomes a DB-managed setting the
    cleaner job reads.

OPEN decisions:
- [x] How much job output/log to retain and show — DECIDED in the `job-queue` design: keep the most
      recent N job rows (default N=100, stored as `app_config.output_retention_count` so it is
      tunable without a rebuild) and prune older whole rows; the viewer shows the live/most-recent
      output.

Order: LATER feature — depends on the SQLite DB + workers-read-DB (settings-db-core) and couples
with the realtime log viewer and the `recordings` table (item 8). Replaces the old "step 2". Do
NOT fold into settings-db-core (the running step 1).

MERGED: branch `job-queue` / worktree `.worktrees/job-queue` (started 2026-10-23, merged 2026-10-23). Requirements
(`.agents/tasks/job-queue-2026-10-23/requirements.md`) and the technical design
(`.agents/tasks/job-queue-2026-10-23/design.md`) are authored (no production code yet). Design
decomposes the work into six dependency-ordered FEATs mirroring requirements §1–6:
(1) `jobs` + `schedules` + `app_config` schema + in-place migration/seed in `src/api/db/`;
(2) generic `worker` service (`src/worker/`, 3s poll loop, global single-job lock via conditional
claim, busy=SKIP marking "skipped, busy", ported cleaner + peakfilegenerator handlers,
`Dockerfile.worker` with ffmpeg + audiowaveform, RW `./data` so it can write job status, stale-lock
reclaim at boot); (3) scheduler hosted in the **api** (A1) with a pure `isDue` and a `last_run_at`
no-double-enqueue guard; (4) docker-compose: remove cleaner + peakfilegenerator services, add
`worker`, keep `recorder` separate; (5) delete `settings.json` entirely and move
recorder_minute/cleaner_minute/peakfile_minute/log_retention into the DB (recorder re-reads its
minute from the DB, best-effort hot-reschedule via a 5-min re-read timer, else on restart);
(6) SSE live job view (`GET /api/jobs/stream`, 1s DB-poll + diff, behind requireAuth) + scheduler
config / Run-now admin UI + output retention. New pure logic gets `node:test` coverage:
`isDue` (hourly/daily/weekly, incl. a "one-minute-late evaluation still fires" case), `decideClaim`
(busy-skip), retention threshold + `validateRetentionHours`.
The design went through a design review (`design-review.json` / `design-review.md`, verdict
CHANGES_REQUESTED: 0 HIGH / 4 MEDIUM / 3 NIT) and was revised to Pass 2, resolving all findings:
shared `AUDIO_DIR` constant for the ported handlers (no `__dirname`-relative paths after the move),
a `SQLITE_BUSY` bounded-retry on the worker's terminal/claim/skip writes (so a contended write never
strands a `running` row) backed by the boot stale-lock reclaim, a concrete nginx change
(`proxy_buffering off` + `proxy_read_timeout 1h` on the existing `/api/` block) for SSE, and a
bounded catch-up scheduler (`previousScheduledInstant` + 3-minute lookback + `last_run_at` guard)
so a delayed loop cannot lose a daily/weekly fire. Still no production code — design is review-clean
and ready to implement.

IMPLEMENTATION PROGRESS (2026-10-23):
- [x] FEAT-001 (jobs/schedules/app_config schema + in-place migration/seed + api data-access layer)
      DONE on branch `job-queue`. `src/api/db/schema.js` gains additive `CREATE TABLE IF NOT EXISTS`
      for `jobs` (+ indexes `idx_jobs_status_created`, `idx_jobs_created`), `schedules`, `app_config`
      — all run from `applySchema(db)`, so an existing `app.db` migrates in place (AC-11). New
      synchronous idempotent `src/api/db/seed-jobconfig.js` (`seedJobConfig`) seeds the two schedule
      rows (cleaner hourly min 10, peakfilegenerator hourly min 5, both enabled) + `app_config`
      `log_retention=2`, `recorder_minute=0`, `output_retention_count=100` via `INSERT OR IGNORE`
      (never overwrites user-changed values). Bootstrap in `src/api/index.js` is now
      `applySchema(db); seedJobConfig(db); seedAdmin(db).then(startServer)` — `seedJobConfig`
      synchronous and BEFORE the awaited `seedAdmin`. Data-access services added: `services/jobs.js`
      (`enqueueJob`/`listRecentJobs`/`getJob` + a TERMINAL-ONLY `pruneJobOutput` that can never
      prune a pending/running row), `services/schedules.js`
      (`listSchedules`/`getSchedule`/`updateSchedule` with 0..59 minute unification +
      `markScheduleRun`), `services/app-config.js` (`getConfig`/`setConfig` +
      `parseOutputRetentionCount` fallback-to-100). `validateRetentionHours` +
      `parseOutputRetentionCount` were PORTED into `src/api/lib/config-validate.js` (the api image
      only COPYs `src/api/`, so a cross-service require into `src/cleaner` would break at runtime).
      Tests: `test/config-validate.test.js` (retention bound + out-of-bounds + output-retention
      parse/fallback) and `test/jobs-schema.test.js` (temp-DB integration: schema + indexes +
      columns, idempotent schema + seed, enqueue, listRecentJobs, terminal-only prune). `cd src/api
      && node --test` -> 23 pass / 0 fail in node:26-bookworm (host has no node; ran via the locked
      image). Committed locally; not pushed. Later FEATs: read `output_retention_count` through
      `parseOutputRetentionCount` before `pruneJobOutput(n)`.
- [x] FEAT-002 (generic `worker` service + `Dockerfile.worker`) DONE on branch `job-queue`. New
      `src/worker/`: `db.js` opens the worker's OWN RW `node:sqlite` handle setting ONLY
      `busy_timeout` + `foreign_keys` and NEVER `journal_mode` (the api owns it), with the open +
      PRAGMAs inside a bounded `SQLITE_BUSY` retry (`withBusyRetry`, Atomics.wait `sleepSync`) so a
      not-yet-ready DB at boot and a contended write are both tolerated (MEDIUM-1). `claim.js`: pure
      `planTick({pending})` ([]→idle, [A]→claim A, [A,B,C]→claim A + skip B,C) + the effectful
      skip-then-claim `applyPlan` (skips written first so a lost claim can't re-run the extras).
      Ported pure helpers `settings-utils.js` (`validateRetentionHours`) + `filename-utils.js`
      (`extractFileDateTime`); `handlers/paths.js` exports `AUDIO_DIR` (env override, no `__dirname`
      form). `handlers/cleaner.js` reads `log_retention` from `app_config` via the RW handle,
      validates, THROWS on out-of-bounds → failed (no `process.exit`), recomputes the threshold per
      run, deletes with SYNCHRONOUS fs; per-file error logged, top-level unreadable dir throws
      (MEDIUM-2). `handlers/peakfilegenerator.js` reads `streams` folders from the DB and keeps the
      faithful two-level walk + skip-on-null + current-hour skip + per-file `audiowaveform`
      best-effort (MEDIUM-3). `worker.js`: independent `setInterval` heartbeat (5s, decoupled from
      the tick), non-overlapping 3s poll loop, boot stale-`running` reclaim, `SQLITE_BUSY`-retried
      terminal writes, and `capOutput` (64 KiB UTF-8-safe tail, drops a split leading multi-byte
      sequence). `Dockerfile.worker` = node:26-bookworm + ffmpeg + BBC audiowaveform 1.10.2.
      Tests (`src/worker/test/`): `planTick`, `validateRetentionHours`, `extractFileDateTime`,
      byte-exact + multi-byte-safe `capOutput`. `cd src/worker && node --test` → 11 pass / 0 fail
      (via the locked node:26-bookworm image; host has no node). `docker build -f Dockerfile.worker`
      succeeds and both `ffmpeg` (5.1.9) + `audiowaveform` (1.10.2) resolve on PATH. NOTE: the
      design's scalar `decideClaim` was superseded by `planTick` (plan-the-whole-pending-set, design
      §2.4). The worker is NOT yet wired into `docker-compose.yml` (FEAT-004); when it is, its
      `./data` mount MUST be read-write (the recorder stays `:ro`), else the first claim throws
      `SQLITE_READONLY`. Committed locally; not pushed.
- [x] FEAT-003 (DB-driven scheduler hosted in the api) DONE on branch `job-queue`. New
      `src/api/scheduler/index.js` exports `startScheduler(db)` + the pure, DB-free
      `previousScheduledInstant`/`withinLookback`/`isDue` (CALENDAR-FIELD date math, never ms
      subtraction, so a daily/weekly step-back across a Europe/Amsterdam DST transition keeps HH:MM).
      `startScheduler` runs a 30s `setInterval` (unref'd): for each enabled schedule it enqueues a
      pending job + `markScheduleRun` when owed (3-minute lookback + `last_run_at===dueInstant`
      guard = no double-enqueue), then prunes job output via `pruneJobOutput(parseOutputRetentionCount(...))`.
      Wired into `startServer()` AFTER the routers mount (a scheduler failure never blocks the HTTP
      server). Tests: `test/scheduler.test.js` (14 pure cases incl. one-minute-late-still-fires,
      stale-beyond-lookback, the guard, + DST crossings) and `test/scheduler-enqueue.test.js`
      (integration: two evaluations a minute apart enqueue exactly one row). `cd src/api && node
      --test` → 40 pass / 0 fail. Committed locally; not pushed.
- [x] FEAT-004 (docker-compose wiring) DONE on branch `job-queue`. Removed the `cleaner` +
      `peakfilegenerator` service blocks; added the `worker` service (build `Dockerfile.worker`,
      `restart: unless-stopped`, `./audio` rw + `./data` READ-WRITE [documented override so it can
      write job status], `TZ=Europe/Amsterdam`, `depends_on` api `service_healthy`, NO `networks:`
      key, heartbeat healthcheck tightened to age<30s / interval 15s / timeout 10s / retries 3 /
      start_period 30s). `recorder` kept separate (still `./data:...:ro`). `docker compose config
      --services` → api, frontend, recorder, worker. `docker compose build worker` succeeds; ffmpeg
      + audiowaveform both on PATH. Committed locally; not pushed.
- [x] FEAT-005 (remove `settings.json` entirely + delete ported-away sources/Dockerfiles) DONE on
      branch `job-queue`. `src/recorder/streams-db.js` gains `readRecorderMinute()` (opens the `:ro`
      handle, `SELECT value FROM app_config WHERE key='recorder_minute'`, validates 0..59, returns a
      number; not-ready/missing/invalid → default 0 + log, NEVER `process.exit`, mirroring
      `readStreams`). `recorder.js`: the `settings.json` `readFileSync`/`JSON.parse`/`process.exit`
      blocks are gone; the minute is now a reassignable `let currentMinute = readRecorderMinute()`,
      the cron task is captured (`let task = cron.schedule(...)`), and a best-effort re-read timer
      (shortened first retries ~15s/~60s after a fallback boot, then a steady 5-min cadence) calls
      `readRecorderMinute()` and, on change, `task.stop()` + reassigns a new `cron.schedule(newExpr,
      fn)` and logs it (fallback documented in-code: a changed minute otherwise takes effect on next
      restart). The startup catch-up IIFE and the recorder's `path.join(__dirname,'./audio/...')`
      are UNCHANGED. Deleted the root `settings.json`, both `settings.json` bind-mounts (recorder +
      api) from compose, and `src/cleaner/`, `src/peakfilegenerator/`, `Dockerfile.cleaner`,
      `Dockerfile.peakfilegenerator`. `grep -rn 'settings.json' src docker-compose.yml` shows only
      explanatory comments (no runtime reader, no mount). New `src/recorder/streams-db.test.js`
      covers `readRecorderMinute` (stored value, 0/59 bounds, missing row, out-of-range, non-integer,
      not-ready → 0); `cd src/recorder && node --test` → 13 pass / 0 fail. `docker compose config`
      validates; service set is recorder/worker/api/frontend. Committed locally; not pushed.
- [x] FEAT-006 (SSE live job view + log viewer + output retention + admin UI) DONE on branch
      `job-queue`. New `src/api/routes/jobs.js`, mounted at `/api/jobs` in `index.js`, ALL behind
      `requireAuth` (AC-7; public `/api/settings` + `/api/settings2` untouched, AC-10):
      `GET /api/jobs?limit=50` (int 1..200, default 50, out-of-range → 400 `{field:'limit'}`);
      `POST /api/jobs {type}` → `enqueueJob(type,'manual')` 201 (the Run-now trigger; bad type → 400
      `{field:'type'}`); `GET /api/jobs/schedules` → `listSchedules()`; `PUT /api/jobs/schedules/:type`
      → `updateSchedule` (unknown type 404; per-field validation → 400 `{error,field}`);
      `GET`/`PUT /api/jobs/config/log_retention {hours}` reusing `validateRetentionHours` (1..8760,
      invalid → 400 `{field:'hours'}`); DB errors → 500. Plus `GET /api/jobs/stream` SSE behind
      `requireAuth`: `text/event-stream` + `X-Accel-Buffering: no`, a per-connection ~1s read-poll
      diffing against the last snapshot, emitting `snapshot` on connect, `job` on any changed row,
      `ping` every 15s, torn down (both timers cleared + `res.end()`) on `req` close (NFR-5); the poll
      is read-only and never holds the write lock. `src/frontend/nginx.conf`: `proxy_buffering off` +
      `proxy_read_timeout 1h` added to the EXISTING `/api/` block (no nested location). Output
      retention wired via `pruneJobOutput` after every manual enqueue (route) AND every scheduled
      enqueue (`scheduler/index.js`), reading `output_retention_count` through the positive-int
      fallback-100 parse (NIT-5); a pure `rowsToPrune(ids,n)` helper added to `services/jobs.js` with
      the AC-12 assertion (a running job survives a prune even with >N newer rows). Frontend: `api.ts`
      gains `JobRecord`/`ScheduleRecord` interfaces + typed clients `listJobs`/`runJobNow`/
      `listSchedules`/`updateSchedule`/`getLogRetention`/`setLogRetention`/`openJobStream` (all
      `credentials:'same-origin'`, surfacing `ApiError`); new `SchedulerConfig.tsx` (per type: enable
      toggle, frequency select with conditional anchors — minute hourly / hour+minute daily /
      day-of-week+hour+minute weekly — Save + Run-now, plus a log_retention input) and `JobViewer.tsx`
      (opens the `EventSource`, renders the recent-jobs list with status badge + trigger + timing +
      output, a NEUTRAL badge for `skipped, busy`, `close()` on unmount); both rendered in
      `SettingsPage.tsx` between `<StreamTable/>` and `<ChangePasswordForm/>`; matching `.job-*`
      styles added to `App.css`. Tests: `src/api/test/jobs-routes.test.js` (13 cases — unauth 401,
      validation 400s, enqueue-drives-a-row, AC-12 prune) and `src/frontend/src/settings/
      JobViewer.test.tsx` (3 cases — snapshot render + neutral skipped badge, job-event merge,
      close-on-unmount). Verified in node:26-bookworm: `cd src/api && node --test` → 53 pass / 0 fail;
      `cd src/frontend && npm install && npm run build` clean + `npm test` → 9 pass / 0 fail.
      Committed locally; not pushed.
- [x] CROSS-FEAT INTEGRATION VERIFICATION + COLD-DATA CONVERGENCE SMOKE DONE on branch `job-queue`
      (iteration 1, no source fixes needed — the six FEAT seams integrated cleanly). Full evidence in
      `.agents/tasks/job-queue-2026-10-23/verification.md`. In node:26-bookworm: `docker compose
      build` built all four images (recorder/worker/api/frontend; cleaner/peakfilegenerator gone),
      the worker image has `ffmpeg` (5.1.9) + `audiowaveform` (1.10.2) on PATH, and the suites are
      green — api 53, worker 11, recorder 13 (`node --test`), frontend build clean + vitest 9. The
      cold-data smoke ran on an ALTERNATE host port (PORT=9793, `-p asl-jobqueue`, isolated cold
      `./data` under /tmp so the user's live stack on 9703 and the worktree `./data` were never
      touched): all four services reached `healthy` with NO settings.json present; admin/admin login
      through nginx; `PUT /api/jobs/schedules/cleaner` updated the schedule; a manual cleaner job ran
      pending→running→done; two overlapping jobs → the oldest ran `done` and the second was `skipped`
      with output exactly `skipped, busy` (started_at null, never ran); the SSE endpoint through
      nginx delivered a `snapshot` event then `job` events on enqueue (unauth `/api/jobs/stream` →
      401, as were unauth GET/POST jobs + PUT schedule); the recorder read `recorder_minute` from the
      DB and, after a stream was added, its startup catch-up recorded the current hour from the DB;
      public `GET /api/settings` (streams from the DB) and `GET /api/settings2` (no `test` field)
      both stayed 200; and the worker heartbeat stayed fresh (age 0.3–4.1s vs the 30s threshold) with
      0 restarts across the job runs. Torn down with `down` (NOT `-v`); root-owned smoke artifacts
      cleaned up so `./data` and `.worktrees` stay clean.

### 11. Recorder: robust per-stream process management (DECIDED — Option B) — MERGED + PUSHED (CHUNK B)
IMPLEMENTED + TESTED + COMMITTED on the `recorder-resilience` branch (plan at
`.agents/tasks/audiostreamlogger-recorder-resilience-2026-10-23/plan.md`, verification at
`.agents/tasks/audiostreamlogger-recorder-resilience-2026-10-23/verification.md`; see the branch
section above), reviewed APPROVED, then fast-forward merged into main and pushed (main == b293435). Ran in parallel with CHUNK A, strictly confined to
`src/recorder/`. Per-stream supervision with capped exponential backoff, recorder-scope graceful
shutdown (SIGTERM/SIGINT finalizes each mp3 via `kill('SIGTERM')`), greppable per-stream error/gap
logging, and the scope-added periodic new-stream catch-up poll are all in place.
Current: one recorder container loops over all streams and starts an ffmpeg process per stream
inside that single container; all streams share one fate and failures are logged-and-swallowed.
User confirmed the recorder stays ONE container (continuous recording, not an on-demand job — see
item 10), but the internal process management should be more robust.

DECIDED (Option B — one container, robust internal per-stream supervision):
- [ ] Supervise each stream's ffmpeg process independently: if one stream's process dies, restart
      only that stream (with retry/reconnect + backoff), leaving the other streams untouched.
- [ ] A stream that is briefly down should reconnect rather than silently leaving a gap; emit a
      clear per-stream error/gap log line (ties into the LOW "ffmpeg errors swallowed" debt).
- [ ] Combine with graceful shutdown (settings-db graceful-shutdown step): on SIGTERM/SIGINT stop
      each stream's ffmpeg cleanly.
Deliberately NOT container-per-stream (Option C) — dynamically creating/removing containers per
stream is overkill for this project (same "keep it manageable" reasoning as SQLite over Postgres).
Order: later; pairs naturally with the graceful-shutdown work and the recordings-table/gap analysis.

### 12. Editable branding (page title + icon/favicon) from the settings screen (user wish)
Status: IMPLEMENTED on branch `admin-config` (CHUNK A, FEAT-001; not yet merged). Verified: api 60
`node:test` green in node:26-bookworm, frontend `npm run build` + 9 vitest green, `docker compose
build api frontend` green.
Currently the page title ("Dé radiologger") is hardcoded in src/frontend/index.html and the
favicon is a static src/frontend/... asset. User wants to change both from the admin/settings
screen (white-labeling).

Title (simple, text):
- [x] Store the title as `app_config.app_title` (default 'Dé radiologger', seeded INSERT OR IGNORE
      in src/api/db/seed-jobconfig.js; validated in app-config.js: non-empty, trimmed <=200).
- [x] Expose via the API: PUBLIC `GET /api/app-config/public` -> {title}; authed
      `PUT /api/app-config/title`.
- [x] Frontend reads the title and sets document.title at runtime (src/frontend/src/App.tsx).
- [x] Edit field in the settings screen (src/frontend/src/settings/BrandingSettings.tsx).

Icon / favicon (a bit more — it's an uploaded BINARY file, not a text setting):
- [x] Upload the icon from the admin screen — authed `POST /api/branding/favicon` with a
      route-local express.raw (png/ico/svg, 1 MiB cap; type+size validated in lib/validate-favicon.js).
- [x] Store/serve it: bytes written to a file under ./data (/usr/src/app/data/branding/favicon.<ext>)
      with a DB reference (app_config.favicon_path + favicon_mime). Chosen file-on-volume approach.
- [x] Serve the current favicon dynamically: PUBLIC `GET /api/branding/favicon` streams the stored
      file or a bundled default (src/api/assets/default-favicon.png); index.html <link rel="icon">
      points at that stable path.

Order: small-to-medium; fold into the settings/admin-screen + DB-config work. The title is trivial;
the icon upload needs a small file-upload + storage/validation story.

### 16. Auto-start a newly-added stream for the rest of the current hour (user wish)
When a new stream is added on the settings page, it should immediately start recording and keep
going until the end of the current hour, then join the normal hourly cycle — exactly like the
existing startup catch-up, but triggered by a stream being ADDED rather than by boot.
- Reuses the recorder's existing building blocks: the startup catch-up logic, the
  `secondsUntilNextHour` helper, and the DB-backed stream list (recorder already reads streams
  read-only from the DB).
- Mechanism (PROPOSED — Option A, confirm when building): the recorder PERIODICALLY polls the DB
  stream list (e.g. every 30-60s) and, for any stream with no recording yet for the current hour,
  starts a remainder-of-the-hour recording. The existing "exists = skip" check prevents
  double-recording streams that already have a file. Simple, fits the read-only-DB model, no new
  infra; downside is up-to-~1-min latency before recording starts.
  - Alternative (Option B, heavier): the api actively signals the recorder (HTTP endpoint or a job
    row). More direct but makes the recorder half-controllable — less preferred.
- Order: AFTER Chunk B merges (it touches src/recorder/recorder.js — doing this concurrently would
  conflict). NOT folded into Chunk B (its plan was already finalized as supervision/shutdown/logging
  only). Decide Option A vs B with the user at build time.

### 17. Stream list ordering, default stream, and country-grouped view (user wish)
A cluster of related ordering/organization features for the stream list (the data-model parts can
land before the later full frontend overhaul; the richer UI pieces pair with it):
- [ ] Manual ORDER of the logger/stream list: let the user arrange the streams in a chosen order
      (not just insertion/id order). BACKEND DONE on branch `stream-ordering` (FEAT-001): additive
      `sort_order` column + idempotent migration, ordering applied in GET /api/settings / /api/streams,
      and a `PUT /api/streams/reorder` persistence endpoint. REMAINING (FEAT-002, frontend): the
      reorder UI in the admin screen (drag-handle or up/down arrows) that calls the endpoint.
- [ ] DEFAULT stream selectable from the dashboard: an app_config key `default_stream_folder` + a
      control in the admin screen to pick it; the player preselects/loads that stream on open.
      Validate the chosen folder still exists. BACKEND DONE on branch `stream-ordering` (FEAT-001):
      key + validation, `GET /api/app-config/public` now returns `default_stream_folder`, and a
      `PUT /api/app-config/default-stream` setter that validates the folder exists / clears on empty.
      REMAINING (FEAT-002, frontend): the admin picker control + player preselect.
- [ ] COUNTRY-GROUPED view: show the stream list grouped by country with the stations indented
      under each country. The user must be able to order the COUNTRIES themselves AND order the
      stations WITHIN each country. Data model: a country ordering + a per-country station ordering
      (e.g. country_position + the stream sort_order scoped within country). UI: a grouped/tree
      layout with reordering at both levels.
- Note: the grouped-tree UI overlaps with the later full frontend overhaul (user wants that
      separately, not now); the DB/ordering model + API can be built independently of the visual
      overhaul. Sequence the data model first, the rich tree UI with/after the overhaul.

### 18. Reconcile/full-sync worker job between disk and the recordings DB (user wish)
The recordings table (Chunk C) is populated incrementally by the recorder/worker/cleaner, plus a
one-time startup backfill. But disk and DB can drift over time (a crash mid-write, a file removed
out-of-band, a missed event). Add a periodic FULL SYNC that reconciles both directions:
- [x] New worker JOB TYPE "reconcile" (alongside cleaner + peakfilegenerator) — fits the existing
      job-queue/worker + scheduler model, so it can be scheduled (e.g. daily) and run manually too.
- [x] Two-way reconcile: files on disk with no DB row -> insert; DB rows whose file no longer
      exists -> remove/mark missing; fix mismatched size/duration/status. Reuse the startup-backfill
      logic (generalize it into the shared reconcile so there's one implementation).
- [x] Respect the global single-job lock (busy=skip) like the other jobs; log a summary
      (added/removed/fixed counts) visible in the SSE job viewer.
- [x] Expose it in the admin scheduler UI as a schedulable type with a "Run now" button.
Order: AFTER Chunk C lands (needs the recordings table + job model). Natural follow-on; could fold
into Chunk C follow-ups or be its own small workflow.
DONE + merged to main from branch `reconcile-job` (worktree `.worktrees/reconcile-job`), decomposed
into FEAT-001 (shared planner) + FEAT-002 (worker job type + UI + seed):
- [x] FEAT-001 DONE (merged to main): generalized the startup-backfill reconcile logic into a
      SHARED PURE two-way planner `src/api/services/reconcile-planner.js` —
      `reconcilePlan(existingRows, scannedFiles, options) -> { inserts, removes, updates }` (no fs,
      no DB). It folds `.partN` segments per (folder,date,hour) slot, plans inserts (disk-only
      slots), removes (db-only rows — full-sync, matching the cleaner's row removal), and updates
      (drifted status/segment_count/file_path), with a guard that NEVER removes or restatuses the
      actively-recorded slot (status 'recording' OR date-hour === currentStamp). `runBackfill` now
      consumes it INSERT-ONLY (identical startup behaviour) and re-exports `reconcilePlan` for
      backward compat. New `src/api/test/reconcile-planner.test.js` (all three directions + the
      guard + idempotency) plus the updated `recordings-backfill.test.js`; api suite green (127
      tests) in node:26-bookworm. FEAT-002 ports this planner byte-for-byte into
      `src/worker/reconcile-planner.js`.
- [x] FEAT-002 DONE (merged to main): worker "reconcile" job type — ported the planner byte-for-byte
      into `src/worker/reconcile-planner.js`, added `src/worker/handlers/reconcile.js` (two-level
      AUDIO_DIR walk, applies inserts/updates/removes over the worker RW handle in withBusyRetry,
      summary line with added/removed/fixed counts), registered `reconcile` in the worker HANDLERS
      map (no second lock — the existing busy-skip poll lock governs it), added row-write helpers in
      `src/worker/recordings-db.js`, enumerated `reconcile` across api schema/routes/openapi + the
      frontend typed client, and seeded a daily/03:30/enabled reconcile schedule. New worker planner
      + handler tests, `jobs-schema.test.js` now asserts 3 seeded schedules. The scheduler UI + job
      viewer are data-driven, so the card + Run-now surface automatically.

### 21. Admin screen: stream health panel (user wish, 2026-10-23) — DONE (v2 two-signal, merged to main == b06db8b + pushed)
First version MERGED to main (== dda1412): a `/settings` StreamHealth panel + requireAuth
`GET /api/analysis/stream-health`, deriving ok/degraded/down/never per stream from the `recordings`
rows over a 24h window.

REDESIGN (user, 2026-10-23) — DONE, merged to main and pushed. The first version was WRONG in practice: with the recorder running fine
it showed almost every stream "degraded" and "0 streams OK", because the 24h missing-hour gap count
drove the status AND the current slot was computed in UTC while the recorder names hour-slots in
Europe/Amsterdam (a 2h CEST offset), so the in-progress/just-finished hour was counted as missing.
The user wants health split into TWO INDEPENDENT signals, shown as two columns:
- [x] **"Now" (green check)** — is this stream recording RIGHT NOW, yes/no. This is the ONLY thing
      that decides the green check. Derive it from the `recordings` table for the CURRENT hour-slot
      computed in **Europe/Amsterdam** time (the recorder's timezone): the current hour has status
      `recording` (or a fresh/complete row for the current slot) → green; otherwise → not OK. The
      in-progress current hour must NEVER be treated as a "missing" failure. Do NOT let any 24h gap
      count affect this column.
- [x] **"Last 24h" (separate column)** — a short summary of recording-time gaps over the past 24h,
      purely informational (does NOT affect the green check). E.g. "complete" or "3 gaps: 02:00,
      05:00, 06:00" (Amsterdam-local hour labels). This is where the old gap logic lives, fixed for
      the Amsterdam timezone and excluding the in-progress current hour.
- [x] Fix the TIMEZONE bug at its root: the api route must build "now"/the current slot in
      Europe/Amsterdam (matching how the recorder names files), not UTC. The pure helper already
      expects a local-time currentSlot — the bug is in the caller (`src/api/routes/analysis.js`).
- [x] Keep the endpoint requireAuth + OpenAPI-documented; the frontend `StreamHealth.tsx` becomes a
      two-column table (Now check + 24h summary) instead of the current "problem streams" list.
Order: pairs with item 18 (reconcile) and item 8's analysis view — all read the `recordings` table.
Touches api (route timezone fix + helper split) + frontend (two-column panel). The green check is a
live "recording now" signal; the 24h gap summary is separate and informational.

### 22. Per-stream recording quality: configurable codec, bitrate, and bit depth (user wish, 2026-10-23)
The user wants to set the audio CODEC, BITRATE, and BIT DEPTH per stream, used by the recorder when
capturing that stream. Today the recorder records with fixed ffmpeg settings; these become
per-stream, admin-editable fields.
- [x] Data model: add per-stream recording-quality columns to the `streams` table (+ migration) —
      DONE on branch `stream-quality` (FEAT-001): additive `codec TEXT NOT NULL DEFAULT 'mp3'`,
      `bitrate_kbps INTEGER` (backfilled to 160), `bit_depth INTEGER` (NULL) via a guarded
      `migrateStreamsQuality(db)` mirroring the `sort_order` precedent. Defaults reproduce today's
      fixed mp3@160/44100 behaviour exactly. Allowlist resolved to `mp3`/`opus`/`flac` (aac dropped —
      audiowaveform can't read the m4a container; see design §4).
- [x] Validation: codec from an allowlist; bitrate/bit-depth constrained to values valid for the
      chosen codec — DONE on branch `stream-quality` (FEAT-001): authoritative server-side
      `validateQuality` in `lib/validate-stream.js` (lossy mp3/opus require an in-set bitrate +
      forbid bit_depth; lossless flac requires bit_depth in {16,24} + forbids bitrate; case-sensitive
      codec). The admin-form combination-gating is the later frontend FEAT.
- [ ] Recorder: map the per-stream fields to the ffmpeg args (currently execFileSync array args),
      and reflect the codec in the OUTPUT FILE EXTENSION/container (today everything is `.mp3`; a
      flac/opus/aac stream needs the right extension + the peak-file + browse/player paths updated
      to not assume `.mp3`). This is the biggest ripple — the `.mp3` assumption is wired through the
      recorder, worker peakfilegenerator, cleaner, recordings parser, and the frontend player. Audit
      every `.mp3` assumption before changing the container.
- [ ] Admin UI: codec/bitrate/bit-depth controls in the stream add/edit form.
Order: touches recorder + worker + api + frontend + schema — a sizeable cross-cutting feature.
Needs a build-time decision on which codecs/containers to support and how to handle the deep `.mp3`
assumption. Sequence as its own workflow; coordinate with item 23 (storage estimate reads the same
per-stream quality settings).

### 23. Admin screen: storage estimate for current settings (user wish, 2026-10-23)
The user wants to see an ESTIMATE of how much data the application will store given the current
settings — a projected disk-usage figure shown in the admin screen.
- [x] Compute an estimate from: the number of streams, each stream's recording quality (codec +
      bitrate + bit depth — see item 22; until that lands, use the current fixed encoding), and the
      log-retention window (hours) that bounds how much is kept on disk at steady state. Roughly:
      per-stream bytes/hour (derived from bitrate, or measured from existing recordings) × retention
      hours, summed over all streams.
- [x] Show it in the admin screen (next to retention / the analysis panels): projected steady-state
      total, ideally a per-stream breakdown, and optionally compare against actual current on-disk
      usage (the `recordings` table already tracks `size_bytes`, so a measured bytes/hour per stream
      is available as a more accurate basis than a theoretical bitrate calc).
- [x] Likely a requireAuth api endpoint (e.g. `GET /api/analysis/storage-estimate`) returning the
      projection + a frontend panel. Pure calculation logic should be unit-tested (node:test).
Order: depends on retention config (already in the DB) and benefits from item 22's per-stream
quality fields; most accurate if it uses measured `size_bytes` from the `recordings` table. Touches
api + frontend. Sequence after item 22 (or build the measured-bytes version first and refine once
item 22's per-stream quality exists).
DONE + MERGED to main AND pushed to origin/main (2026-10-23, branch `storage-estimate`, review
APPROVED, fast-forward merge). Pure helper
`src/api/services/storage-estimate.js` (`estimateStorage` + `theoreticalBytesPerHour`): per-stream
bytes/hour = MEASURED mean `size_bytes` over complete recordings when available (`source:"measured"`),
else THEORETICAL from the item-22 quality fields (`source:"estimated"`) — lossy = `bitrate_kbps *
1000/8 * 3600`, FLAC = documented `FLAC_ESTIMATED_KBPS=900` scaled by bit depth — × the `log_retention`
window, summed. requireAuth `GET /api/analysis/storage-estimate` (routes/analysis.js) also reports
actual on-disk bytes; documented in openapi/spec.js. Frontend panel
`src/frontend/src/settings/StorageEstimate.tsx` rendered after `<RecordingsAnalysis />` (human-readable
total + retention window + actual + per-stream table with measured/estimated badges). Read-only: no
schema change, no writes. api 223 node:test + frontend 45 vitest green, build clean. Evidence:
`.agents/tasks/verification.md`.

### 24. Live auto-refresh of the currently-recording hour in the player (user wish, 2026-10-23)
Problem: when the user opens the hour that is CURRENTLY being recorded, the player loads a snapshot —
the mp3 and the peak `.json` as they were at open time — and never updates, so newly-recorded audio
and the growing waveform don't appear without a manual reload.
CHOSEN APPROACH (brainstormed with user, 2026-10-23): periodic refresh, NOT incremental peak append.
- audiowaveform (BBC, what the worker uses) CANNOT append to / incrementally extend an existing peak
  file — it builds the whole peak file in memory and writes it once (see bbc/audiowaveform issue #100,
  which is about chunked WRITING for memory, not append). Rejected incremental-append and a custom
  waveform-data.js DSP pipeline as over-engineering for hour-sized files (a full regen of one hour's
  peaks is only tens of KB and cheap).
- [x] Backend: periodically REGENERATE the peak `.json` for the current-hour file only (e.g. every
      30-60s) while that hour is still recording, overwriting the existing `.json`. Fits the existing
      worker/job model (a lightweight current-hour peak refresh) or a small recorder-side tick. Stop
      regenerating once the hour is finalized (the normal post-hour peakfilegenerator run produces the
      final file). DONE on `live-hour-refresh` (FEAT-001): a NEW worker handler
      `src/worker/handlers/currenthourpeaks.js` driven by an INDEPENDENT `setInterval(CURRENT_HOUR_PEAK_MS)`
      (default 30s, env-overridable) in `worker.js`, decoupled from the single-job busy lock. It full-
      rebuilds + OVERWRITES only the PRIMARY `<folder>-<stamp>.<ext>` current-hour peak `<base>.json`
      per stream (ext = per-stream codec, FEAT-002); `.partN` segments are out of scope (primary only).
      The existing peakfilegenerator current-hour SKIP stays. Decided cadence constant:
      `CURRENT_HOUR_PEAK_MS`. Still needed for item 24: FEAT-002 frontend live-poll + cache-busting.
- [ ] Frontend: detect that the selected hour IS the current hour and poll/reload the source
      periodically (reload the mp3 — it has grown — and the refreshed peak `.json`), plus a manual
      "refresh" button as a fallback. Only poll for the live hour; past hours are static.
- [ ] Edge cases to handle: the peak `.json` may not exist yet for the current hour (show the mp3 /
      a partial or empty waveform gracefully, don't error); a mid-hour recorder restart writes
      `.partN` SEGMENTS (recorder-resilience), so "the current hour" can be multiple files — decide
      whether live refresh follows the primary file only or stitches segments; ensure cache headers
      (api/nginx) don't serve a stale mp3/`.json` for the live hour.
Order: mostly frontend + a small backend peak-refresh; reads the same recording-state as items 8/18/21.
Touches recorder-or-worker + api/nginx (cache headers) + frontend. Needs a build-time decision on the
regen cadence and the `.partN` segment handling. No new dependency (reuse audiowaveform via periodic
regen).

### 19. Triage the first Dependabot PRs (opened 2026-10-23; user wants these picked up)
Dependabot's first run opened 10 PRs. `gh` is installed and authenticated as `denhoo4`. CI
(GitHub Actions) ran on each; status captured 2026-10-23:
- GREEN / safe to merge (all checks SUCCESS):
  - [ ] #3  docker: nginx 1.27-bookworm → 1.29-bookworm (base image)
  - [ ] #5  dev: jsdom 25 → 30 (frontend)  — green despite being a major; verify locally anyway
  - [ ] #7  github-actions group (2 updates)
  - [ ] #9  argon2 0.41.1 → 0.45.1 (api, minor/patch group)  — native build, verify it compiles
- RED / CI FAILING (do NOT merge as-is; need investigation, likely a linked toolchain break):
  - [ ] #10 react + @types/react (frontend)  — fails CI (surprising for react; likely shares the
         frontend toolchain breakage below, or a lockfile/peer issue)
  - [ ] #4  dev: @vitejs/plugin-react 4.7 → 6.1.2 (major)
  - [ ] #6  dev: vite 6.4.5 → 8.3.4 (two majors)
  - [ ] #8  dev: vitest 2.1.9 → 5.0.5 (three majors)
  - [ ] #11 @vitest/mocker + @vitest/coverage-v8 + vitest group
  - [ ] #12 tinypool + @vitest/coverage-v8 + vitest group
  The vite/vitest/plugin-react/jsdom/coverage bumps are interdependent — merging one in isolation
  leaves the toolchain inconsistent and likely keeps CI red. Treat #4/#6/#8/#11/#12 (and possibly
  #10) as ONE bundled frontend-toolchain upgrade: do it in a worktree, update all together, fix the
  vite 8 / vitest 5 config/API changes, get the frontend build + vitest green, then close the
  superseded individual Dependabot PRs.

IN PROGRESS (2026-10-23): the GREEN PRs #3/#5/#7/#9 are merged onto branch
`frontend-toolchain-upgrade` (worktree `.worktrees/frontend-toolchain-upgrade`). The bundled RED
upgrade is planned at `.agents/tasks/frontend-toolchain-upgrade-2026-10-23/plan.md`: bump react/
react-dom → ^19.3.1 (+ @types/react ^19.3.0, @types/react-dom ^19.1.0), @vitejs/plugin-react →
^6.1.2, vite → ^8.3.4, vitest + @vitest/coverage-v8 → ^5.0.5, all in `src/frontend/package.json`,
then `npm install` to regen the lockfile. Known breaking change found: React 19's `@types/react`
makes `useRef<HTMLDivElement>(null)` return `RefObject<HTMLDivElement | null>`, so the
`UseWavesurfer.containerRef` interface field in `src/frontend/src/useWavesurfer.ts` must widen to
`RefObject<HTMLDivElement | null>`. The minimal vite/vitest configs are expected to carry over
unchanged (public API shapes stable across these majors); build + `vitest --run` are the authority.
All verification runs inside `node:26-bookworm` (host has no node); the superseded PRs are closed
after merge.
CODED + VERIFIED (2026-10-23) on branch `frontend-toolchain-upgrade`: all eight version ranges
bumped in `src/frontend/package.json` and the lockfile regenerated via `npm install` (resolved
react/react-dom 19.3.1, @types/react 19.3.0, @types/react-dom 19.3.0, vite 8.3.5,
@vitejs/plugin-react 6.1.2, vitest + @vitest/coverage-v8 5.0.5; jsdom/wavesurfer/typescript/
testing-library untouched). Two breaking changes fixed: (1) the anticipated React-19 ref widening of
`UseWavesurfer.containerRef` to `RefObject<HTMLDivElement | null>` in `src/useWavesurfer.ts`; (2) an
additional vitest-5 type break — `@testing-library/jest-dom` v6 only augments vitest's `Assertion`
via its `./vitest` entrypoint, so `src/test/setup.ts` now imports `@testing-library/jest-dom/vitest`
and `tsconfig.app.json`'s `types` lists `@testing-library/jest-dom/vitest` (fixes
`toBeInTheDocument`/`toBeDisabled`/etc. "does not exist on Assertion" errors). The minimal vite/
vitest configs carried over unchanged. All four verifications pass GREEN in `node:26-bookworm`:
`npm install` exit 0, `npm run build` (tsc -b + vite 8) exit 0, `npm run test -- --run` 20/20 across
7 files, `npm run test:coverage` (v8, report-only) exit 0, plus a `npm ci && build && test`
reproducibility run exit 0. Evidence: `.agents/tasks/frontend-toolchain-upgrade-2026-10-23/verification.md`.
Committed on the branch; NOT pushed/merged (handled by the merge/finalize step, which also closes the
superseded Dependabot PRs #4/#6/#8/#10/#11/#12).
REVIEW (2026-10-23): semantic review APPROVED — gate
`.agents/tasks/frontend-toolchain-upgrade-2026-10-23/review.json` `verdict=APPROVED`, NO blocking
findings. package.json + regenerated lockfile match the target matrix (all resolved versions inside
their ranges, jsdom left at 30.1.3), the two breaking-change fixes (React-19 ref widening + jest-dom
`/vitest` entrypoint re-wire) are sound, the minimal vite/vitest configs needed no migration (coverage
stays v8 report-only), and the four GREEN verification commands are evidenced in verification.md
(independently spot-checked the lockfile resolved versions only; suites not re-run per the review
contract). Narrative: `.agents/tasks/frontend-toolchain-upgrade-2026-10-23/review.md`. Next: the
merge/finalize step.
APPROACH when resuming: `gh pr list`; for each GREEN PR fetch the branch, run the relevant
service's `npm ci && npm test` (+ `docker compose build` for #3) in node:26-bookworm locally to
confirm, then `gh pr merge --squash`. Merge order matters (shared frontend package.json/lockfile):
do the non-frontend ones (#3, #7, #9) first, then tackle the bundled frontend upgrade. Note #5 is a
major but CI-green — still verify before merging.

### 20. Decision point: API docs — add OpenAPI/Swagger to Express vs. migrate api to FastAPI
DECIDED (user, 2026-10-23): Option 1 (OpenAPI docs on the existing Express api), NOT a FastAPI rewrite.
DONE + MERGED to main (fast-forward == a60165a) from branch `api-openapi-docs`.
- [x] Option 1 (cheap, recommended if the goal is just docs/validation): add OpenAPI docs to the
      EXISTING Express api. Prefer a schema-first approach (e.g. `zod` + `zod-to-openapi`) so the
      spec stays in sync with the code (closest to the FastAPI feel), served via `swagger-ui-express`
      behind requireAuth. Alternative: hand-written `swagger-jsdoc` annotations (drifts more easily).
      DONE: `zod@^4.6.7` + `@asteasolutions/zod-to-openapi@^9.1.0` + `swagger-ui-express@^5.0.1` added
      to `src/api/package.json` (lockfile regenerated). A pure `src/api/openapi/spec.js`
      (`buildOpenApiDocument()`, no DB/session side effects) describes the REAL routes read from
      `routes/*.js` (auth, streams/settings/app-config, jobs incl. the SSE stream, analysis, branding,
      backup, util, healthz — 24 paths) as an OpenAPI 3.0.0 document with tags + a `connect.sid`
      session-cookie security scheme on authed ops. `src/api/openapi/docs.js` (`mountDocs`) serves the
      Swagger UI at `GET /api/docs` and the raw spec at `GET /api/docs.json`, BOTH behind the existing
      `requireAuth` (admin-only — docs not publicly reachable); wired in `index.js` after the session +
      global `express.json`. nginx `location /api/` already proxies both paths (no nginx change). New
      `node:test` suite `test/openapi-docs.test.js` (spec-shape unit check + anon-401 / authed-200
      integration). Verified in node:26-bookworm: 119 api tests pass (114 existing + 5 new), and a
      throwaway-container boot smoke on an ALTERNATE port confirmed anon `/api/docs.json` + `/api/docs`
      → 401 and `/healthz` → `{status:ok}`.
- [ ] Option 2 (big, only with a broader motive) — REJECTED: migrate the api service to FastAPI (Python), which
      ships Swagger `/docs` + ReDoc `/redoc` automatically. This is a full rewrite of ONE service in
      another language (all routes incl. SSE, Argon2id auth + session store, the node:sqlite DB layer
      shared with the Node worker/recorder, ffmpeg call, Dockerfile, AND the api test suite). High
      effort/risk, no functionality gain — justified only if moving the backend to Python for other
      reasons (Python audio/data/ML ecosystem), NOT merely for docs.
Recommendation: do NOT migrate just for docs — Option 1 (zod) gets ~80% of the FastAPI feel for a
fraction of the effort. DECIDED in favour of Option 1; DONE and MERGED to main (== a60165a).

### 14. Validate stream URLs are reachable/valid when setting them (user wish)
DECIDED (user, 2026-10-23): NON-BLOCKING "Test" button, NOT a hard block on save — a stream can be
temporarily down, so saving must never be blocked by a transient outage. FORMAT validation stays the
only hard gate on create/update; reachability is a separate, explicit, admin-triggered probe.
DONE + MERGED to main (fast-forward == d7b1ed8) from branch `stream-url-validation`; branch +
worktree cleaned up. Implementation plan at
`.agents/tasks/stream-url-validation-2026-10-23/plan.md`; semantic review APPROVED (no blocking
findings — one non-blocking note: SSRF IP/CIDR denylist intentionally absent, an accepted admin-only
trade-off) at `.agents/tasks/stream-url-validation-2026-10-23/review.md` / `review.json`. Verified in
node:26-bookworm: api 158/158, frontend 26/26 + clean `tsc -b && vite build`.
Scope is `src/api/` + `src/frontend/` only; no schema/recorder/worker/compose/nginx/journal_mode
change, and the save path does NOT depend on reachability.
- [x] Format validation (already done in stream CRUD: must be a valid http(s) URL). Kept as the only
      hard save-gate — unchanged.
- [x] NEW `POST /api/streams/test-url` (requireAuth): re-validates the url (reuse `validateUrl`,
      400 on malformed/non-http(s)), then a BOUNDED HTTP(S) GET probe (built-in `node:http`/`https`,
      6s hard timeout, ≤3 http(s)-only redirect hops) that inspects status + content-type/ICY headers
      (audio/*, application/ogg, HLS mpegurl, icy-* → audio) and returns
      `{reachable, status?, contentType?, detail}`. PROBE APPROACH DECISION: HTTP header inspection
      over ffprobe (a live radio stream never hits EOF, so ffprobe must always be killed by timeout;
      header inspection is cheaper, deterministic, and gives a clean injectable seam for unit tests).
      ffmpeg/ffprobe IS in the api image but is not used here. SSRF: admin-only, so http/https +
      bounded timeout + header-only read, no IP denylist (would break legit radio hosts). Probe logic
      is an injectable module `src/api/lib/probe-stream-url.js` unit-tested with a FAKE transport (no
      real network); route tested behind requireAuth (401 anon). Documented in `openapi/spec.js`.
- [x] NEW frontend "Test" button next to the URL field in the add/edit form (`StreamTable.tsx`) that
      calls a typed `testStreamUrl()` client in `api.ts`, shows a pending state, and renders the
      result inline (green reachable / red not-reachable + detail) via an `aria-live` region —
      WITHOUT blocking or auto-saving.
Order: small-to-medium admin feature; built standalone on the `stream-url-validation` worktree,
review APPROVED, MERGED to main (== d7b1ed8).

### 15. Stop replacing `_` with a space in stream names (user decision 2026-10-23)
History: the project was originally built requiring stream names to use `_` instead of spaces
(spaces broke the old code), and the frontend compensated by replacing `_` -> space when
displaying. User now wants `_` to stay `_` everywhere — no display-time substitution.
- [ ] Remove the `name.replace(/_/g, ' ')` display substitution everywhere it occurs (the player
      stream selector in App.tsx and anywhere in the admin screen / browse-tree that does it).
      Show the stored name verbatim. (Also check the api's /settings2 browse-tree key building —
      it historically mapped underscores to spaces for the station key; that must stay verbatim too
      if we want names shown as stored.)
- Being FOLDED INTO the running `admin-config` (Chunk A) workflow since it touches src/frontend
  (sent as a scope addition 2026-10-23) to avoid a frontend merge conflict.
- [x] DONE (folded into `admin-config` Chunk A, 2026-10-23): the historical underscore-to-space
  display workaround is removed. Stream/station names now display VERBATIM —
  src/frontend/src/App.tsx player selector renders `s.name` as stored, and
  src/api/lib/settings-transform.js keys the /settings2 browse tree by the stored station name
  verbatim (dropped the final `key.replace(/_/g,' ')` remap; its test asserts verbatim keying). No
  `replace(/_/` underscore-to-space logic remains in source.

### 13. Wavesurfer: scroll-to-zoom at the cursor (user wish)
- [ ] In the waveform, scrolling (mouse wheel) should zoom IN/OUT, centered on the point under
      the cursor where you scroll (zoom toward the pointer, not just a global zoom). wavesurfer v7
      has zoom support; wire wheel events on the waveform container to adjust the zoom level and
      keep the scroll position anchored at the cursor's time position.
- Note: the legacy webpack bundle had a mouse-wheel-zoom extra that was not carried into the React
  rebuild (noted under frontend-react findings); this item is the cursor-anchored version of that.
- Frontend-only (src/frontend), touches the useWavesurfer hook; small-to-medium.
- IN PROGRESS: `wavesurfer-zoom` branch/worktree. Implementation plan authored at
  `.agents/tasks/wavesurfer-zoom-plan.md`. Old behavior recovered from the pre-React bundle
  (`git show 687eafd~1:frontend/web/main.js`): wheel on `#waveform`, `preventDefault`, step 5
  px/sec per event (deltaY sign only), lower-clamp 0, no upper clamp, `zoom(minPxPerSec)` units,
  and it was a GLOBAL zoom (no cursor anchor). Decision: keep the old direction/step/clamp but
  ADD cursor-x anchoring (the user's explicit ask) via the v7 scroll math; extract a pure
  `nextZoom(current, deltaY)` helper so the step/clamp is unit-testable. Change confined to
  `useWavesurfer.ts`.

### 14. DB backup/export + import from the admin screen (user wish, item 10 "S2")
Status: IMPLEMENTED on branch `admin-config` (CHUNK A, FEAT-003; not yet merged). Verified: api 69
`node:test` green in node:26-bookworm (incl. 9 new backup tests), frontend `npm run build` + 14
vitest green, `docker compose build api frontend` green.
- [x] Export a JSON backup (authed `GET /api/backup/export`): `{version:1, exported_at, streams,
      app_config}` as a downloadable attachment. Only an allowlist of safe app_config keys is
      exported (`app_title`, `log_retention`, `recorder_minute`, `output_retention_count`);
      favicon/worker-status/secret keys are dropped.
- [x] Download the raw SQLite file (authed `GET /api/backup/db`) as an `app.db` octet-stream
      attachment (404 when missing) — the cheap full-backup option.
- [x] Import a previously exported JSON (authed `POST /api/backup/import`, route-local
      `express.json({limit:'5mb'})`): each stream is validated with the SAME `validateStream` used
      by stream CRUD and upserted BY FOLDER (create or update); only allowlisted app_config keys are
      applied (reusing per-key `setConfig` validation). Returns `{imported, updated, skipped,
      config_applied, config_skipped}`. NEVER touches users/sessions/jobs/schedules.
- [x] Pure, unit-tested logic in `src/api/lib/backup.js` (`buildBackup` / `pickSafeConfig` /
      `validateBackup` + `SAFE_CONFIG_KEYS`) with node:test coverage of the version check, per-stream
      validation, the config allowlist, and a temp-DB import upsert-by-folder integration test.
- [x] Admin UI `src/frontend/src/settings/BackupSettings.tsx` (mounted in SettingsPage): Download
      backup (JSON) / Download raw database buttons + an Import file picker that reads the file as
      JSON, calls the import endpoint, and renders an imported/updated/skipped summary.
- Note: `SAFE_CONFIG_KEYS` in `src/api/lib/backup.js` is the single source of truth for which
  app_config keys round-trip through a backup — extend it there if a new portable key is added.

### 9. A real testing strategy (user wish)
Current state: there IS some testing already, but thin and opportunistic (only pure helpers that
happened to be involved in bug fixes):
- `node:test` in src/cleaner (validateMinute/validateRetentionHours), src/peakfilegenerator
  (extractFileDateTime), src/api (buildBrowseTree), src/recorder (secondsUntilNextHour).
- src/frontend has one vitest test.
What is missing (= the real work):
- [ ] A coherent testing strategy instead of scattered tests: agreement on unit vs integration,
      where tests live, how to run them (per service + overall).
- [ ] Endpoint/integration tests for the API (login/auth flow, stream CRUD, /settings, /settings2,
      /util/selection-export) instead of only pure helpers. Grows with the DB/auth features.
- [ ] Frontend: more than the single render test (wavesurfer button interaction, settings screen,
      login flow).
- [ ] Workers: isolate and cover more testable logic (now only a few helpers).
- [ ] CI enforcing tests on every push/PR (GitHub Actions) — ties into item 3 (Renovate) and the
      "just stay current" wish.
- [ ] Decide on a coverage picture (which lib, which threshold).
Order: partly organic (each feature workflow already adds tests), but plan a deliberate testing
strategy + CI as its own step. Choices (test runner consistency node:test vs vitest everywhere,
coverage tool, CI provider) still to be decided with the user.

---

## Technical debt / ugly bits
Full read-only audit done. Full report with file/line citations: `.agents/tasks/techdebt-audit.md`.
The list below is the summary, sorted by priority. These items do NOT overlap with the
security-update / React / API-split / DB plans above — it is separate resilience/correctness debt.

Pick up first (HIGH):
- [x] `routes/api.js` `/settings2` called `.map()` on the settings *object* instead of `.streams`
      -> endpoint always threw a TypeError (500). Fix: `JSON.parse(...).streams`. FIXED in the
      api-split (file moved to `api/routes/api.js`).
- [x] `peakfilegenerator.js`: `filename.match(/…/)[0]` crashed on any `.mp3` without a date pattern
      (e.g. `temp-*.mp3`) and aborted the whole run. Fix: guard the match. FIXED on `techdebt-high`
      (FEAT-002): `extractFileDateTime` returns `null` instead of `[0]` on null; non-matching files
      are skipped.
- [x] No `restart:` policy and no healthchecks in `docker-compose.yml`; combined with
      `process.exit(1)` as the only error handling a crash is permanent. Fix: `restart:
      unless-stopped` + healthcheck per service, and stop blindly exiting on transient errors.
      FIXED on `techdebt-high` (FEAT-003): `restart: unless-stopped` + healthchecks on all five
      services, cron callbacks in try/catch, heartbeats + `GET /healthz`.
- [x] `cleaner/deletefiles.js`: `thresholdTime` computed once at boot -> retention window grows
      every uptime hour. Plus `log_retention` validated as `< 60`, so >59h retention was impossible
      (readme example uses 168). Fix: compute the threshold in the cron callback and give
      `log_retention` its own sensible bound. FIXED on `techdebt-high` (FEAT-002): `thresholdTime`
      recomputed per cron run; `validateRetentionHours` allows 1..8760h (168 works now).
- [x] No tests in the original services (recorder/cleaner/peakfilegenerator/API). Fix: a minimal
      `node:test` suite on the pure logic. DONE on `techdebt-high` (FEAT-004): three suites on the
      pure helpers, no new deps, `test` script in the three `package.json`s; all suites exit 0.

Then (MEDIUM):
- [ ] Duplicated settings read + minute validation across all three workers, with diverging bounds
      and messages. Fix: one shared `loadSettings()` + `validateMinute()` module.
- [ ] `recorder.js` writes to `audio/${folder}` from settings without a containment check; becomes
      user input once the settings screen/DB exists. Fix: folder allowlist + path.resolve check.
      (Being addressed in the settings-db-core step via the write-path validation.)
- [x] Blocking sync I/O + `execSync` with shell-interpolated paths (peakfilegenerator). Fix:
      `fs.promises` + `execFile`/`spawn` (also removes the quoting/injection risk).
      DONE on `code-quality` (CHUNK D): `execSync` → `execFileSync` with array args for both
      audiowaveform and ffprobe via a pure `src/worker/handlers/exec-args.js` builder (unit-tested);
      the shell/quoting layer is gone so paths can never be interpolated into a shell. The per-file
      walk + skip-on-null-date behavior is preserved. (Kept sync fs intentionally — the worker runs
      one job at a time and relies on synchronous handler completion.)
- [ ] No graceful shutdown (SIGTERM/SIGINT) in the workers or the Express server; recorder can
      leave a half file mid-ffmpeg. (Planned as settings-db step 4.)
- [ ] `api.js` `/settings2`: implicit global `transformedJson` (no const/let) = shared mutable
      state between requests; plus a leaking `test` field in the response. (In the API cleanup of
      the settings-db work.)
- [ ] `settings.json` is gitignored but mounted in every container; a fresh clone has no file and
      every service exits. (Superseded by the DB migration — settings.json is going away entirely.)

Lower (LOW):
- [x] Page title: the editable app title (Chunk A) is applied on the MAIN/player page via runtime
      document.title, but the /settings admin screen's document.title did NOT update to the
      configured title. Fix: apply the app_config title to document.title on the settings route too
      (shared effect/hook so both routes set it from the same source). DONE on `code-quality`
      (CHUNK D): extracted a shared `src/frontend/src/useAppTitle.ts` hook (calls
      `getPublicConfig()`, same fallback) used by both `App.tsx` and `SettingsPage.tsx`.
- [x] `recorder.js`: ffmpeg errors are swallowed silently (only console.error), no retry/gap log.
      RESOLVED by Chunk B (per-stream supervision + capped backoff + greppable per-stream
      error/restart/give-up lines). Re-checked in CHUNK D: fully covered, no code change needed
      (the Chunk D logging-helper adoption only reroutes those same lines through `log.error` with
      identical text, so the grep patterns still match).
- [x] `index.js` mounted the same util router on both `/util` and `/logger` (duplicate route).
      RESOLVED in the api-split: `/logger` alias dropped in `api/index.js`.
- [x] `express.json()` without a `limit` on the util router (unbounded body). RESOLVED earlier: a
      single global `express.json({limit:'100kb'})` in `api/index.js` covers every route (util.js no
      longer mounts its own); the backup `/import` route keeps a deliberate `5mb` limit. Re-confirmed
      in CHUNK D (no code change).
- [x] Logging: only `console.log`, no levels, inconsistent timestamps/error messages. DONE on
      `code-quality` (CHUNK D): a tiny dependency-free `log` helper (`info`/`warn`/`error`, each line
      prefixed with an ISO-8601 timestamp + level token) added per service (`src/api/lib/log.js`,
      `src/worker/log.js`, `src/recorder/log.js` — identical copies, unit-tested once) and adopted at
      the services' own startup/operational log lines.
- [x] Four near-identical Dockerfiles + worker `package.json`s (duplication, drift); `npm install`
      instead of `npm ci`. DONE on `code-quality` (CHUNK D): generated the missing api + worker
      `package-lock.json` (recorder/frontend already in sync) and switched all four Dockerfiles from
      `npm install` to `npm ci`; proven with `npm ci` exit 0 per service + a full `docker compose
      build` in node:26-bookworm. Dockerfiles left separate on purpose (they differ meaningfully) to
      avoid over-engineering. (Also added the missing `COPY src/recorder/log.js` line.)
- [x] `readme.txt` -> `README.md`; rewritten to reflect the current architecture (five services,
      src/ layout, docker compose v2, correct PORT 9703, actual settings.json shape). Retention
      example (168) is now consistent after `techdebt-high` widened the bound to 1..8760h.
- [x] Placeholder metadata (`author: "Your Name"`); frontend `package.json` lacks name/version/scripts.
      DONE on `code-quality` (CHUNK D): removed the recorder `author: "Your Name"` placeholder and
      added `description`/`license` to recorder + api + worker `package.json`. The frontend
      `package.json` already had name/version/scripts (that part was resolved earlier), so it was
      left untouched.
- [x] `.DS_Store` in the repo root; added to `.gitignore` and untracked.
