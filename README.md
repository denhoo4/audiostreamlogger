# audiostreamlogger

A multi-service Docker application that records internet audio streams (radio stations) hourly,
generates waveform peak files, cleans up old recordings, and serves a web interface to browse,
play, and download the recordings.

The services are managed with Docker Compose.

## Architecture

The application consists of four services (source under `src/`):

| Service | Directory | Role |
| --- | --- | --- |
| `recorder` | `src/recorder/` | Records each stream every hour (ffmpeg). On startup it catches up the remaining part of the current hour if no recording exists yet. Reads its run minute from the database. |
| `worker` | `src/worker/` | Generic job runner. Polls the `jobs` table and executes one job at a time (cleaner = delete recordings past the retention window; peakfilegenerator = generate `audiowaveform` peak files). Replaces the old `cleaner` + `peakfilegenerator` containers. |
| `api` | `src/api/` | Express API: serves the stream list and the recordings browse tree, handles cutting/downloading fragments, powers the login-gated admin screen (authentication, stream CRUD, job scheduling + Run-now + a live job feed), and hosts the DB-driven scheduler that enqueues jobs. Runs internally on port 3000, not public. |
| `frontend` | `src/frontend/` | React + Vite single-page app, served by nginx. nginx also serves the audio and reverse-proxies `/api`, `/util`, and `/auth` to the `api` service (same-origin, so no CORS needed). |

The `recorder` records at a configured minute of each hour. The `cleaner` and `peakfilegenerator`
are no longer separate containers: they are job types run by the `worker`, triggered either on a
per-type schedule (hourly/daily/weekly, configured in the admin screen) or on demand via "Run now".
At most one job runs at a time across all types; a job that would overlap a running one is skipped
("skipped, busy"). Audio is shared via a volume (`./audio`).

All configuration — the stream list, the per-type schedules, the run minutes, and the log-retention
window — lives in a SQLite database at `./data/app.db` (bind-mounted into the containers, so it
survives rebuilds). The `api` and `worker` mount `./data` read-write; the `recorder` mounts it
read-only. The database is created and seeded automatically on first start. There is no
`settings.json` — it has been removed entirely.

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
- add, edit, and remove streams (country is picked from an ISO 3166-1 list).

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
into the containers (`api` and `worker` read-write, `recorder` read-only) so the database survives
rebuilds. The file is created and seeded automatically on first start and is not committed to git
(only `data/.gitkeep` is tracked). There is no `settings.json` any more — all of its former contents
moved into the database and are managed from the admin screen.

### Configuration (admin screen)

Everything that used to live in `settings.json` is now edited in the login-gated `/settings` screen
and stored in the database:

- **Streams** — each stream has a `country`, `name`, `folder`, and `url`; `folder` is the
  subdirectory under `audio/` where that station's recordings go, and recording files are named
  `<folder>/<folder>-YYYY-MM-DD-HH.mp3`.
- **Schedules** — per job type (`cleaner`, `peakfilegenerator`) an enable toggle and an
  hourly/daily/weekly schedule with the matching anchor (minute; hour+minute; day-of-week+hour+minute).
  A "Run now" button enqueues a one-off manual job.
- **Log retention** — the retention window for recordings, in **hours** (e.g. `168` for seven days),
  read by the cleaner job.
- The recorder run minute is seeded in the database (`recorder_minute`, default `0`) and re-read by
  the recorder without a restart.

The admin screen also shows a live job feed (status, trigger, timing, and captured output) that
updates in real time over Server-Sent Events.

## Recording layout

Recordings are stored under `audio/<folder>/` named `<folder>-YYYY-MM-DD-HH.mp3` (local time,
timezone `Europe/Amsterdam`). A `.json` peak file is generated per mp3 for the waveform display in
the frontend.

## Development

The frontend is a React + Vite + TypeScript app in `src/frontend/`. Run locally:

```sh
cd src/frontend
npm install
npm run dev
```

Tests (where present) run per service with the built-in `node --test`, and in the frontend with
Vitest.
