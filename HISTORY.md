# History — audiostreamlogger

The story of how this project got to where it is: what was built, in roughly the
order it happened, and — more usefully for a future reader — *why* the big
decisions went the way they did. For how the system fits together today see
[ARCHITECTURE.md](ARCHITECTURE.md); for what is still open see [TODO.md](TODO.md);
for working style and preferences see [HANDOVER.md](HANDOVER.md).

This file absorbs the completed-work log that used to bloat `TODO.md`. Nothing
here is a live task — it is the record of finished work.

## Where it started

audiostreamlogger began as a small set of plain Node scripts that recorded a few
internet radio streams on a cron-like minute, generated waveform peak files, and
cleaned up old recordings, with a webpack-bundled frontend to browse and play
them. Configuration lived in a gitignored `settings.json` that was bind-mounted
into every container. It worked, but it had the usual rough edges of a project
that grew organically: no tests, no restart policy, duplicated settings-reading
logic across services, `execSync` with shell-interpolated paths, and a handful of
latent crashes (a `/settings2` route that called `.map()` on the wrong object; a
peak-file parser that threw on any filename without a date pattern; a retention
threshold computed once at boot so the window silently grew with uptime).

The modernization effort set out to fix that foundation and then build features
on top of it.

## The big architectural decisions

These are the choices worth understanding before touching the code.

**`settings.json` → SQLite database.** The single biggest shift. The gitignored
JSON file mounted into every container was fragile (a fresh clone had no file, so
every service exited) and had no good story for a web-based admin screen. All
configuration moved into a SQLite database at `./data/app.db`: streams,
per-job-type schedules, the recorder run minute, retention window, branding, and
worker status. There is no `settings.json` any more — it was removed entirely.

**Four-service split, with a generic worker.** The stack settled on four services:
`recorder`, `worker`, `api`, and `frontend` (nginx). The old standalone `cleaner`
and `peakfilegenerator` containers were folded into one generic `worker` that runs
one job at a time across all job types. This consolidation removed duplicated
container plumbing and gave a single place to reason about the "only one heavy job
at a time" invariant.

**`node:sqlite` over `better-sqlite3`.** The DB layer uses Node's built-in
`node:sqlite` (`DatabaseSync`) rather than the `better-sqlite3` native addon. That
avoids a native build step in every image and ties the project to the Node 26
baseline it already targets.

**`journal_mode=DELETE` over WAL.** The database is bind-mounted and shared by
three services (api owns schema/config/stream/job writes; worker and recorder each
open their own scoped read-write handle). DELETE journal mode was chosen over WAL
for predictable behavior across that shared-file, multi-process access pattern.

**argon2id for auth, server-side sessions.** Authentication uses argon2id password
hashing with a server-side, revocable session store backed by SQLite (not a
stateless JWT). The admin screen is same-origin behind nginx, so the session
cookie needs no CORS dance.

**Same-origin frontend.** nginx serves the built SPA, serves recorded audio under
`/audio`, and reverse-proxies `/api`, `/util`, and `/auth` to the api. The whole
app is same-origin, which keeps auth simple and avoids CORS entirely.

**Per-stream codecs, and de-`.mp3`-ification.** Recording quality became
per-stream: codec (`mp3`/`opus`/`flac`) with a bitrate for the lossy codecs or a
bit-depth for flac. This required removing the assumption, baked in all over the
recorder/worker/api, that every recording is a `.mp3` — filenames now carry the
real extension and every parser/scanner handles all three.

**The two-signal stream-health redesign.** The first stream-health admin panel was
wrong in practice: it read the clock in UTC while the recorder stamps slots in
`Europe/Amsterdam`, and its single ok/degraded/down/never model made a
perfectly-healthy recording-in-progress read as "0 streams OK". It was rebuilt
around two independent signals — a **Now** green check (is there a `recording` row
for the current Amsterdam hour-slot?) and a separate, purely informational
**Last 24h** gap summary — with the timezone bug fixed by a dedicated
Amsterdam-slot helper using `Intl.DateTimeFormat`. The lesson stuck: "recording
right now" and "had gaps yesterday" are different questions and deserve different
signals.

## Recorder resilience

The recorder earned several hardening passes that are worth knowing about:

- **Per-stream ffmpeg supervision.** Each stream's ffmpeg runs independently, so
  one stream dropping mid-hour doesn't disturb the others. A mid-hour restart
  writes a `.partN` segment with capped backoff.
- **Startup + periodic catch-up.** On boot and on a ~30s poll, the recorder catches
  up the remaining part of the current hour for any stream with no recording yet,
  so a newly-added stream starts recording immediately instead of waiting for the
  next hour.
- **Graceful shutdown.** SIGTERM/SIGINT finalizes each in-flight mp3 rather than
  leaving a truncated file.
- **Greppable gap logging.** Per-stream error/restart/give-up lines are logged in a
  consistent, greppable shape.

## The job queue and scheduler

The worker polls a `jobs` table and runs one job at a time across all types
(`cleaner`, `peakfilegenerator`, and later `reconcile`). A DB-driven scheduler in
the api enqueues jobs on each type's hourly/daily/weekly schedule; a global
single-job busy lock means a job that would overlap a running one is skipped
("skipped, busy"). The admin screen shows a live job feed over Server-Sent Events
plus a "Run now" button for one-off manual jobs. The worker also backfills each
`recordings` row's duration/size via ffprobe and removes the row when the cleaner
unlinks its file.

## The recordings table and analysis

A `recordings` table tracks every captured hour-slot (status
`recording` → `complete`/`partial`, plus size). A one-time startup backfill in the
api reconciles existing audio files into rows. On top of it sit the analysis
endpoints (`/api/analysis/summary`, `/api/analysis/gaps`, and later
`stream-health` and `storage-estimate`) and the admin analysis view.

## Code-quality and testing foundation

A deliberate sweep replaced `execSync`/shell interpolation with `execFileSync` and
array args (removing the quoting/injection risk), added a tiny dependency-free
per-service `log` helper with levels and ISO timestamps, switched all Dockerfiles
from `npm install` to `npm ci` against committed lockfiles, and cleaned up
placeholder package metadata.

The testing strategy landed as its own step: `node --test` per backend service
(api/worker/recorder) and `vitest` for the frontend, a CI workflow
(`.github/workflows/ci.yml`) that tests each service and builds all four images on
every push and PR, `.github/dependabot.yml` for weekly dependency PRs, and the
`ARCHITECTURE.md` + `docs/TESTING.md` docs. Coverage runs report-only
(non-blocking).

## The feature items (roughly chronological)

The bulk of the later work came as numbered feature items, most of them user
wishes. Grouped by theme:

**Admin & branding**
- Editable page title + favicon upload from the admin screen.
- Worker status (alive/stale, last-seen age, current job).
- Existing-hours selector for the analysis view.
- DB backup/export (streams + an allowlist of safe config) + raw-DB download +
  JSON import that upserts streams by folder and never touches users/sessions.
- Stream names shown verbatim — the historical `_`→space display substitution was
  removed (names store and display exactly as entered).

**Streams**
- Non-blocking **Test** reachability probe (item 14): format validation stays the
  only hard save-gate; reachability is a separate admin-triggered HTTP(S) header
  probe, so a transient outage never blocks saving.
- Stream ordering + a default stream + a country-grouped admin view (item 17):
  additive `sort_order` column, reorder controls, and a `default_stream_folder`
  the player preselects.
- Per-stream recording quality (item 22): codec/bitrate/bit-depth, plus the full
  de-`.mp3`-ification across recorder/worker/api. (Integration caught a real bug:
  libopus rejects 44100 Hz, so opus is pinned to 48000 Hz.)
- Stream-folder lifecycle (items 25/26): deleting a stream removes its folder +
  `recordings` rows behind a typed-folder confirmation; renaming a folder moves
  the files and re-points the rows. The rename is **stamp-anchored** (parse the
  filename, rebuild the canonical path) rather than a blind SQL `REPLACE` — a blind
  replace would have corrupted the date stamp for numeric folder names like
  `100nl`, `z100`, and `m2o`. Both operations refuse (409) when a stream is
  recording in the current Amsterdam slot, using a concrete current-slot predicate
  so a purely historical row never blocks.

**Analysis & health**
- Stream-health admin panel, then its two-signal redesign with the UTC→Amsterdam
  timezone fix (item 21, described above under decisions).
- Reconcile worker job (item 18): a two-way disk↔DB sync, schedulable daily,
  inserting missing rows, removing orphans, and fixing drifted status/segment
  counts.
- Storage-estimate panel (item 23): a projected steady-state disk total and
  per-stream breakdown over the retention window, using each stream's measured
  bytes/hour when available or a codec/bitrate estimate otherwise (marked
  measured/estimated), plus actual bytes on disk.

**Player**
- Live auto-refresh of the currently-recording hour (item 24): a worker timer
  (default 30s, decoupled from the job queue) regenerates the current hour's peak
  file while it is still growing, and the frontend polls a cache-busted reload for
  the live hour plus a manual "Ververs" button — with a graceful
  `ws.load(mediaUrl)` fallback when the peak file is briefly missing/partial.

**API docs**
- OpenAPI 3 docs (item 20): schema-first via `zod` + `zod-to-openapi`, served
  through swagger-ui-express at `/api/docs` (raw spec at `/api/docs.json`), both
  behind `requireAuth` since the API is admin-only. A FastAPI rewrite was
  considered and rejected — it would rewrite one service in another language for no
  functional gain.

**Admin layout**
- The admin `/settings` screen reorganized into four tabs — Streams; Recordings &
  health; Jobs; System (item 27). Pure frontend reorganization: no panel added or
  removed, no behavior/API/schema change. Styling was kept intentionally minimal
  pending the deferred full UI/UX overhaul.

## Notable fixes

- A recorder folder-containment tech-debt fix plus graceful shutdown in the worker
  and api (`f71c038`).
- A recorder `Dockerfile` hotfix (`926c0dd`): a missing `COPY folder-utils.js` had
  crashed the recorder at boot in production. This is the origin of a standing
  gotcha — the recorder/worker images COPY source files individually, so every new
  module needs a matching COPY line (see [HANDOVER.md](HANDOVER.md)).
- A stale image once rendered an "undefined" Stream Health panel because only one
  service was rebuilt; the fix in practice is to rebuild the whole stack after a
  frontend/api change.

## Dependency triage

Dependabot's first run opened ten PRs. Four green, independent ones (nginx base
image, jsdom, github-actions, argon2) were merged directly. The remaining six were
interdependent frontend-toolchain bumps, so they were bundled into a single
coordinated upgrade — React 19, Vite 8, Vitest 5, `@vitejs/plugin-react` 6 — with
the two real breaking changes fixed (React 19's ref typing widened
`containerRef` to `RefObject<HTMLDivElement | null>`; `@testing-library/jest-dom`
v6 needed its `/vitest` entrypoint for the Vitest-5 assertion augmentation). See
[TODO.md](TODO.md) for the current state of that triage.
