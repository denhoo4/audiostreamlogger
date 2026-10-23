# audiostreamlogger — TODO & status

Living document tracking the modernization/cleanup of the project.
Last updated: 2026-10-23 (`recorder-catchup` fast-forward merged into `main` == c36d630; README rewritten as README.md; pushed to origin. `settings-db-core` workflow running; DB foundation landed on branch `settings-db-core` using Node's built-in `node:sqlite` after `better-sqlite3` failed to build on Node 26.)

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
  right-click/double-click have since been added (see item 6 note). Smoke test only covers
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
- Cron + retention ALSO via the settings screen (NOT env-only). So this config goes into the DB,
  and the workers must be able to reload the values without a restart (recorder reschedules its
  cron on change). Deliberately chosen complexity.
- Session lifetime: conventional default (e.g. 7 days, httpOnly cookie).
- Write-path validation: YES — folder allowlist (^[a-z0-9_-]+$) + path.resolve containment, since
  folder becomes user input via the screen.
- Graceful shutdown: clean cutoff — SIGTERM/SIGINT handler shuts a running ffmpeg down cleanly.
  (Touches recorder.js; plan relative to recorder-catchup + settings-db.)
- Logging: realtime log pane in the admin/settings screen (stream logs to the frontend, e.g. via
  Server-Sent Events). Conventional, not-too-verbose logging; tune later.
- Push policy: I MAY push to origin/main after every successful merge (user approved).
- DB: SQLite on a persistent volume (./data/app.db bind-mount, survives rebuild). Postgres
  deliberately NOT (too much overhead for 1 admin + a handful of streams).
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
- [running] `settings-db-core` (step 1): SQLite + Argon2id admin/admin + session cookie +
  stream CRUD + basic settings screen + write-path validation + API cleanup + .env.example.
  Streams move to the DB (workers read from the DB too). Cron/retention config STAYS in
  settings.json for this step. (branch settings-db-core, workflow wf_57ab8ef97967fddf)
  - NOTE (DB foundation landed): `better-sqlite3` does NOT compile on node:26-bookworm (its
    native addon uses V8 APIs removed in Node 26), so the api DB handle uses Node's built-in
    `node:sqlite` (`DatabaseSync`) instead — no native build, same prepare/exec surface. `argon2`
    still compiles and is used for the admin hash. Consequence: the SQLite-backed
    `express-session` store choice is reopened for step 2's auth wiring — either a node:sqlite
    session store (keeps revocable server-side logout) or stateless signed cookies (loses it).
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
- [ ] Add `.env.example` (DOES go into git, with dummy values). The real `.env` stays gitignored
      (the `!.env.example` exception already exists in .gitignore). (Part of step 1 above.)
- [ ] Review the frontend port for production: the current `${PORT}:80` in compose + nginx on 80
      internally is conventional, but check: missing default if PORT is unset, no TLS/HTTPS, a
      reverse proxy in front. Tidy up where needed.

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
