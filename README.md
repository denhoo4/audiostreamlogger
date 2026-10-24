# audiostreamlogger

A multi-service Docker application that records internet audio streams (radio stations) hourly,
generates waveform peak files, cleans up old recordings, and serves a web interface to browse,
play, and download the recordings.

The services are managed with Docker Compose.

For a deeper walkthrough of how the services fit together, where configuration
lives, and the CI/dependency setup, see [ARCHITECTURE.md](ARCHITECTURE.md). For
the testing approach and how to run the suites, see [docs/TESTING.md](docs/TESTING.md).

## Architecture

The application consists of four services (source under `src/`):

| Service | Directory | Role |
| --- | --- | --- |
| `recorder` | `src/recorder/` | Records each stream every hour (ffmpeg), supervising each stream's ffmpeg process independently: if one stream drops mid-hour it is restarted on its own with capped backoff (a restart writes a `.partN.mp3` segment) without disturbing the others. On startup, and on a periodic poll, it catches up the remaining part of the current hour for any stream with no recording yet — so a newly-added stream starts recording right away. Shuts down cleanly on SIGTERM/SIGINT (finalizes each mp3). Reads its run minute from the database and writes a `recordings` row per captured hour-slot (status `recording`→`complete`/`partial` + size). |
| `worker` | `src/worker/` | Generic job runner. Polls the `jobs` table and executes one job at a time (cleaner = delete recordings past the retention window; peakfilegenerator = generate `audiowaveform` peak files; reconcile = full two-way sync of the `recordings` table against the on-disk audio tree, inserting missing rows, removing orphans and fixing drifted status/segment counts). Replaces the old `cleaner` + `peakfilegenerator` containers. Also fills each `recordings` row's duration/size (ffprobe) after processing a file and removes the row when the cleaner unlinks its mp3. |
| `api` | `src/api/` | Express API: serves the stream list and the recordings browse tree, handles cutting/downloading fragments, powers the login-gated admin screen (authentication, stream CRUD, job scheduling + Run-now + a live job feed + a recordings-analysis view), hosts the DB-driven scheduler that enqueues jobs, exposes the requireAuth `GET /api/analysis/summary` + `/api/analysis/gaps` + `/api/analysis/stream-health` endpoints, serves interactive OpenAPI 3 docs (Swagger UI at `GET /api/docs`, raw spec at `GET /api/docs.json`) generated from `zod` schemas — both behind requireAuth, since the API is admin-only — and runs a one-time startup backfill that reconciles existing audio files into `recordings` rows. Runs internally on port 3000, not public. |
| `frontend` | `src/frontend/` | React + Vite single-page app, served by nginx. nginx also serves the audio and reverse-proxies `/api`, `/util`, and `/auth` to the `api` service (same-origin, so no CORS needed). |

The `recorder` records at a configured minute of each hour. The `cleaner` and `peakfilegenerator`
are no longer separate containers: they are job types run by the `worker`, triggered either on a
per-type schedule (hourly/daily/weekly, configured in the admin screen) or on demand via "Run now".
At most one job runs at a time across all types; a job that would overlap a running one is skipped
("skipped, busy"). Audio is shared via a volume (`./audio`).

All configuration — the stream list, the per-type schedules, the run minutes, and the log-retention
window — lives in a SQLite database at `./data/app.db` (bind-mounted into the containers, so it
survives rebuilds). All three backend services mount `./data` read-write: the `api` owns the schema
and every config/stream/job write, while the `worker` and the `recorder` each open their own scoped
read-write handle (the recorder writes `recordings` rows for the hours it captures; the worker fills
their duration/size and removes them when cleaning). The database is created and seeded automatically
on first start. There is no `settings.json` — it has been removed entirely.

## Requirements

- Docker
- Docker Compose (v2, the `docker compose` subcommand)

## Getting started

1. Clone the repository:

   ```sh
   git clone https://github.com/denhoo4/audiostreamlogger.git
   cd audiostreamlogger
   ```

2. Create a `.env` with the port the web interface should be reachable on (see `.env.example`):

   ```sh
   cp .env.example .env
   # adjust PORT if desired
   ```

3. Build and run the application:

   ```sh
   docker compose up --build
   ```

4. Open the web interface at `http://localhost:<PORT>` (default `http://localhost:9703`).

5. Open `/settings` and sign in to manage streams, schedules, and retention (see "Configuration"
   below). On first start the database is seeded with a single admin account (username `admin`,
   password `admin`). Change the password from the admin screen right away.

## Stopping

In the terminal running `docker compose up`: `Ctrl+C`. Or, to stop and clean up the containers:

```sh
docker compose down
```

## Admin screen

The `/settings` route is a login-gated admin screen (same-origin session cookie, served by the
`api` under `/auth` and `/api`). From there you can:

- sign in and change the admin password;
- add, edit, and remove streams (country is picked from an ISO 3166-1 list), reorder them with
  per-row ▲/▼ controls, and mark one stream as the default the player preselects — the admin list is
  grouped by country for easier scanning;
- set the page title and upload a favicon (branding);
- see the worker's liveness (alive/stale, last-seen age, current job);
- see a stream-health overview with two independent signals per stream: a **Now** column showing a
  green check when the stream is recording in the current hour-slot (computed in Europe/Amsterdam, the
  recorder's timezone, so the in-progress hour is never flagged as missing), and a separate
  informational **Last 24h** column summarizing recording-time gaps over the past day (e.g. "complete"
  or "3 gaps: 02:00, 05:00, 06:00", current hour excluded) without affecting the green check (backed by
  `GET /api/analysis/stream-health`, read-only, derived from the existing `recordings` rows);
- review a recordings analysis built from the `recordings` table: a per-stream summary (total
  captured hours, stored bytes, recording count, average duration, earliest–latest range) and a
  gap/coverage panel that compares expected versus present hour-slots over a date range and lists
  the missing hours (backed by `GET /api/analysis/summary` and `GET /api/analysis/gaps`);
- export a JSON backup (streams + safe config) or the raw database, and import a backup back
  (streams are upserted by folder; only an allowlist of config keys is applied).

On a fresh database a single admin user is seeded as `admin` / `admin`. Change the password after
the first login.

## Configuration

### `.env`

Copy `.env.example` to `.env` and adjust the values. The real `.env` is not in git; `.env.example`
is the committed template. Keys:

```
# Host port the frontend (nginx) is published on. Compose falls back to 9703 if unset.
PORT=9703
# Secret used to sign session cookies. Change in production.
SESSION_SECRET=change-me-in-production
# Set to 'true' once the stack is served over HTTPS so session cookies get the Secure flag.
COOKIE_SECURE=false
```

If `SESSION_SECRET` is unset or empty the api falls back to an insecure dev secret and logs a
warning; set a real value in production. `PORT` has a `9703` default in Compose, so the stack still
comes up if the variable is unset.

### Database (`./data`)

All configuration is stored in a SQLite database at `./data/app.db`: the stream list, the per-type
job schedules, the recorder run minute, and the log-retention window. The directory is bind-mounted
into the containers read-write for all three backend services (the `api` owns schema + config writes;
the `worker` and `recorder` each hold their own scoped handle for job status and `recordings` rows)
so the database survives rebuilds. The file is created and seeded automatically on first start and is not committed to git
(only `data/.gitkeep` is tracked). There is no `settings.json` any more — all of its former contents
moved into the database and are managed from the admin screen.

### Configuration (admin screen)

Everything that used to live in `settings.json` is now edited in the login-gated `/settings` screen
and stored in the database:

- **Streams** — each stream has a `country`, `name`, `folder`, `url`, a `sort_order` that drives
  the display order (set from the admin reorder controls), and a recording quality (`codec` ∈
  `mp3`/`opus`/`flac`, with a `bitrate_kbps` for the lossy codecs or a `bit_depth` of 16/24 for flac;
  defaults to mp3@160); `folder` is the subdirectory under `audio/` where that station's recordings
  go, and recording files are named `<folder>/<folder>-YYYY-MM-DD-HH.<ext>` where `<ext>` equals the
  stream's codec. A `default_stream_folder` app-config key records which stream the player preselects
  (empty falls back to the first stream).
- **Schedules** — per job type (`cleaner`, `peakfilegenerator`, `reconcile`) an enable toggle and an
  hourly/daily/weekly schedule with the matching anchor (minute; hour+minute; day-of-week+hour+minute).
  A "Run now" button enqueues a one-off manual job.
- **Log retention** — the retention window for recordings, in **hours** (e.g. `168` for seven days),
  read by the cleaner job.
- The recorder run minute is seeded in the database (`recorder_minute`, default `0`) and re-read by
  the recorder without a restart.

The admin screen also shows a live job feed (status, trigger, timing, and captured output) that
updates in real time over Server-Sent Events.

## Recording layout

Recordings are stored under `audio/<folder>/` named `<folder>-YYYY-MM-DD-HH.<ext>` (local time,
timezone `Europe/Amsterdam`), where `<ext>` is the stream's codec (`mp3`/`opus`/`flac`). A `.json`
peak file is generated per recording for the waveform display in the frontend.

## Development

The frontend is a React + Vite + TypeScript app in `src/frontend/`. Run locally:

```sh
cd src/frontend
npm install
npm run dev
```

Tests run per service with the built-in `node --test`, and in the frontend with
Vitest. See [docs/TESTING.md](docs/TESTING.md) for the unit-vs-integration split,
where tests live, the cold-temp-DB integration pattern, and the exact commands
(the host has no Node, so backend suites run inside the `node:26-bookworm` image).

Continuous integration (`.github/workflows/ci.yml`) runs those same commands on
every push and pull request and also builds all four service images; Dependabot
(`.github/dependabot.yml`) opens weekly PRs for npm, Docker base-image, and
GitHub Actions updates.

Each service's Docker image installs dependencies with `npm ci` against the committed
`package-lock.json` for reproducible builds, so keep the lockfile in sync with `package.json`
(run `npm install` in the service directory after changing dependencies and commit the updated
lockfile).
