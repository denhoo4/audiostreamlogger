# audiostreamlogger — TODO & status

Living document tracking the modernization/cleanup of the project.
Last updated: 2026-10-23 (`job-queue` branch COMPLETE + APPROVED, fast-forward merged into main AND pushed to origin/main: the generic `worker` service replaces the old `cleaner` + `peakfilegenerator` containers, `settings.json` is removed entirely, a DB-driven scheduler in the api enqueues per-type hourly/daily/weekly jobs with a global single-job busy=SKIP lock, and an SSE live job view + Run-now admin UI land. All six FEATs (FEAT-001…006) implemented + tested and the full cross-FEAT integration verification + cold-data docker compose convergence smoke PASSED iteration 1 with no code fixes — see `.agents/tasks/job-queue-2026-10-23/verification.md` and item 10. `main` == `job-queue` == 428a385, pushed to origin/main. Earlier on main: settings-db-core step 1 (SQLite DB via node:sqlite after better-sqlite3 failed on Node 26 + Argon2id admin/admin + hand-rolled node:sqlite session store + stream CRUD + login-gated /settings screen + ISO 3166-1 country dropdown + write-path validation + API cleanup + infra/docs wiring). .env untracked on main. ALSO IN PROGRESS: `wavesurfer-zoom` branch — plan authored for mouse-wheel scroll-to-zoom on the waveform, see item 13. `admin-config` branch (CHUNK A) — DONE: APPROVED by the review gate, rebased onto the current main tip and fast-forward MERGED into main AND PUSHED to origin/main. Chunk A delivers five admin-screen / DB-config features: editable page title + editable favicon upload, worker status in the admin screen + a player hour-selector limited to hours that actually exist, and DB backup/export + import. Also folded in: the underscore-to-space name-display workaround is removed (stream/station names shown VERBATIM everywhere incl. /settings2 keys). Verified green in node:26-bookworm (host has no node): api 69 / worker 15 node:test, frontend `npm run build` + 14 vitest. See the `admin-config` branch section below. ALSO: `recorder-resilience` branch (CHUNK B) — ran in PARALLEL with admin-config, strictly confined to `src/recorder/` so the two do not collide; now IMPLEMENTED + TESTED + COMMITTED, semantic review APPROVED, and fast-forward MERGED into main AND PUSHED to origin/main (main == recorder-resilience == b293435; branch also pushed to origin with upstream tracking): per-stream ffmpeg supervision with capped backoff, recorder-scope graceful shutdown (SIGTERM/SIGINT), greppable per-stream error/gap logging, and a scope-added periodic poll that auto-starts a newly-added stream for the rest of the current hour (recorder-only Option A), see item 11 and the `recorder-resilience` branch section below. ALSO IN PROGRESS: `recordings-analysis` branch (CHUNK C) — FEAT-001 (api foundation) DONE: a `recordings` table + indexes, the pure filename parser + analysis helpers + upsert data-access, the requireAuth `GET /api/analysis/summary` + `/api/analysis/gaps` router, and a one-time startup backfill reconcile, all in `src/api` with three new node:test files green (api 83 node:test in node:26-bookworm); `/api/settings2` unchanged; recorder/worker/frontend/compose untouched (FEAT-002..004). FEAT-002 (recorder writes rows + compose `:ro`→rw flip) DONE. FEAT-003 (worker fills duration/size via ffprobe + cleaner removes the recordings row; `parseRecordingParts` + `src/worker/recordings-db.js`) DONE: `cd src/worker && node --test` green (32 tests) in node:26-bookworm, api/recorder/frontend untouched. FEAT-004 (frontend analysis view) DONE: typed `getAnalysisSummary`/`getAnalysisGaps` clients + response interfaces in `src/frontend/src/api.ts`, a new `RecordingsAnalysis.tsx` admin section (per-stream table + gaps/coverage panel) rendered in `SettingsPage.tsx`, and a vitest component test; `cd src/frontend && npm install && npm run build` + `npm test` green (16 tests) in node:26-bookworm, no backend/public-player code touched. All four CHUNK C FEATs (FEAT-001..004) are now implemented + tested on `recordings-analysis`. See the "Larger feature" item 9.)

---

## Branches

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
- [ ] Set up Renovate or Dependabot: automated PRs for both base images (node:XX / nginx:XX) and
      npm packages. This is the only way to keep both the image layer and the package layer current
      (bumping the image tag only covers OS+Node, not the npm deps).

### 4. Clean up stale lockfiles (non-blocking nit from the security review)
- [ ] package-lock.json files still pin old versions. Harmless now because the Dockerfiles use
      `npm install`, but it bites once you move to `npm ci`. Regenerate after the dependency bumps.
      Consider `npm ci` in the Dockerfiles afterwards for reproducible builds.

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

Larger feature (AFTER the DB exists; separate later workflow) — IN PROGRESS on branch
`recordings-analysis` (CHUNK C), decomposed into FEAT-001..004 under
`.agents/tasks/audiostreamlogger-recordings-analysis-2026-10-23/`:
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

### 14. Validate stream URLs are reachable/valid when setting them (user wish)
Two levels — decide at build time how deep to go:
- [ ] Format validation (already done in settings-db-core / stream CRUD: must be a valid http(s)
      URL). Keep this.
- [ ] NEW: actually CHECK the stream URL is reachable / is a real audio stream when the user
      saves it in the admin screen — i.e. a server-side test request (HEAD/GET with a short
      timeout, check status + content-type looks like audio, maybe read a few bytes), returning a
      clear pass/fail to the admin UI. Consider: do it on save (block invalid) vs. a "Test" button
      next to the field (non-blocking). Network-dependent, so handle timeouts/unreachable
      gracefully and don't hang the request. Likely a small api endpoint + a button in the stream
      form. Decide blocking-on-save vs. test-button with the user when building.
Order: small-to-medium admin feature; fold into the admin-screen work or a follow-up to Chunk A.

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
- [ ] Blocking sync I/O + `execSync` with shell-interpolated paths (peakfilegenerator). Fix:
      `fs.promises` + `execFile`/`spawn` (also removes the quoting/injection risk).
- [ ] No graceful shutdown (SIGTERM/SIGINT) in the workers or the Express server; recorder can
      leave a half file mid-ffmpeg. (Planned as settings-db step 4.)
- [ ] `api.js` `/settings2`: implicit global `transformedJson` (no const/let) = shared mutable
      state between requests; plus a leaking `test` field in the response. (In the API cleanup of
      the settings-db work.)
- [ ] `settings.json` is gitignored but mounted in every container; a fresh clone has no file and
      every service exits. (Superseded by the DB migration — settings.json is going away entirely.)

Lower (LOW):
- [ ] `recorder.js`: ffmpeg errors are swallowed silently (only console.error), no retry/gap log.
- [x] `index.js` mounted the same util router on both `/util` and `/logger` (duplicate route).
      RESOLVED in the api-split: `/logger` alias dropped in `api/index.js`.
- [ ] `express.json()` without a `limit` on the util router (unbounded body).
- [ ] Logging: only `console.log`, no levels, inconsistent timestamps/error messages.
- [ ] Four near-identical Dockerfiles + worker `package.json`s (duplication, drift); `npm install`
      instead of `npm ci`.
- [x] `readme.txt` -> `README.md`; rewritten to reflect the current architecture (five services,
      src/ layout, docker compose v2, correct PORT 9703, actual settings.json shape). Retention
      example (168) is now consistent after `techdebt-high` widened the bound to 1..8760h.
- [ ] Placeholder metadata (`author: "Your Name"`); frontend `package.json` lacks name/version/scripts.
- [x] `.DS_Store` in the repo root; added to `.gitignore` and untracked.
