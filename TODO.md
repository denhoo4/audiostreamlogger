# audiostreamlogger — TODO & status

Living document tracking the modernization/cleanup of the project.
Last updated: 2026-10-23 (settings-db-core step 1 COMPLETE + APPROVED, merged into main: SQLite DB (node:sqlite after better-sqlite3 failed on Node 26) + Argon2id admin/admin + hand-rolled node:sqlite session store + stream CRUD + login-gated /settings screen + ISO 3166-1 country dropdown + write-path validation + API cleanup + infra/docs wiring. .env untracked on main. NOW IN PROGRESS: `job-queue` branch — requirements + technical design authored; implementation FEAT-001 (schema + seed + api data-access), FEAT-002 (generic `worker` service + `Dockerfile.worker`), FEAT-003 (DB-driven scheduler in the api), FEAT-004 (compose wiring: cleaner/peakfilegenerator removed, worker added) and FEAT-005 (settings.json removed entirely — recorder reads recorder_minute from the DB with best-effort hot-reschedule; old sources + Dockerfiles deleted) all DONE + tested (see item 10). settings.json is now GONE on this branch. ALSO IN PROGRESS: `wavesurfer-zoom` branch — plan authored for mouse-wheel scroll-to-zoom on the waveform, see item 13.)

---

## Branches

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
- [ ] The hour dropdown currently shows a hardcoded 00-23. Replace it with only the hours that
      actually exist for the chosen stream + day. That data is already in /settings2 (browse tree
      station -> year -> month -> day -> hours[]). Wire the selector to that instead of hardcoded.
      (Likewise optionally limit the day picker to days with recordings.)

Larger feature (AFTER the DB exists; separate later workflow):
- [ ] `recordings` table in the DB: per recording stream/date/hour + duration + file size + status
      (complete/partial). Replaces the filesystem scanning in /settings2 with fast, rich queries.
- [ ] Recorder writes a row per recording; cleaner removes the row on cleanup; peakfilegenerator
      knows the duration (can fill/update it).
- [ ] Analysis endpoints on the API (total recording time, gaps/missing hours, storage per stream,
      average duration) + an analysis view in the frontend.
- Touches all layers (recorder/cleaner/peakfilegenerator/api/frontend); natural next step once the
  SQLite DB exists. Deliberately NOT in the first settings-DB workflow (already large).

### 10. Job queue for on-demand + scheduled cleaner/peakfilegenerator runs (DECIDED — Option A)
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

IN PROGRESS: branch `job-queue` / worktree `.worktrees/job-queue` (started 2026-10-23). Requirements
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

### 11. Recorder: robust per-stream process management (DECIDED — Option B)
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
Currently the page title ("Dé radiologger") is hardcoded in src/frontend/index.html and the
favicon is a static src/frontend/... asset. User wants to change both from the admin/settings
screen (white-labeling).

Title (simple, text):
- [ ] Store the title as an app-config setting in the DB (a small app_settings/config table, or a
      key in whatever config store the settings work introduces).
- [ ] Expose via the API (public GET so the frontend can read it; write behind auth).
- [ ] Frontend reads the title and sets document.title (and any visible header) at runtime instead
      of the hardcoded value.
- [ ] Edit field in the settings screen.

Icon / favicon (a bit more — it's an uploaded BINARY file, not a text setting):
- [ ] Upload the icon from the admin screen (auth-protected upload endpoint).
- [ ] Store/serve it (decide: on the ./data or audio volume as a file + a DB reference, or a blob
      in the DB — a file on the volume is simpler and nginx can serve it). Validate type/size.
- [ ] Frontend/nginx serves the current favicon dynamically instead of the static asset
      (update the <link rel="icon"> / document head at runtime, or serve a fixed path whose
      contents are the uploaded file).

Order: small-to-medium; fold into the settings/admin-screen + DB-config work. The title is trivial;
the icon upload needs a small file-upload + storage/validation story.

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
