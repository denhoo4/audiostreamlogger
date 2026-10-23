# audiostreamlogger

A multi-service Docker application that records internet audio streams (radio stations) hourly,
generates waveform peak files, cleans up old recordings, and serves a web interface to browse,
play, and download the recordings.

The services are managed with Docker Compose.

## Architecture

The application consists of five services (source under `src/`):

| Service | Directory | Role |
| --- | --- | --- |
| `recorder` | `src/recorder/` | Records each stream every hour (ffmpeg). On startup it catches up the remaining part of the current hour if no recording exists yet. |
| `cleaner` | `src/cleaner/` | Deletes recordings older than the configured retention window. |
| `peakfilegenerator` | `src/peakfilegenerator/` | Generates waveform peak files (`audiowaveform`) from the mp3s, for fast rendering in the frontend. |
| `api` | `src/api/` | Express API: serves the stream list and the recordings browse tree, handles cutting/downloading fragments, and powers the login-gated admin screen (authentication, stream CRUD). Runs internally on port 3000, not public. |
| `frontend` | `src/frontend/` | React + Vite single-page app, served by nginx. nginx also serves the audio and reverse-proxies `/api`, `/util`, and `/auth` to the `api` service (same-origin, so no CORS needed). |

The `recorder`, `cleaner`, and `peakfilegenerator` are cron-based workers that run at a configured
minute of each hour. Audio is shared via a volume (`./audio`).

The stream list lives in a SQLite database at `./data/app.db` (bind-mounted into the containers,
so it survives rebuilds). The `api` mounts `./data` read-write; the workers mount it read-only and
read the streams from the DB. The database is created and seeded automatically on first start.

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

3. Provide a `settings.json` in the root (see "Configuration" below). It now only holds the cron
   minutes and the retention window; the stream list lives in the database.

4. Build and run the application:

   ```sh
   docker compose up --build
   ```

5. Open the web interface at `http://localhost:<PORT>` (default `http://localhost:9703`).

6. Open `/settings` and sign in to manage streams. On first start the database is seeded with a
   single admin account (username `admin`, password `admin`). Change the password from the admin
   screen right away.

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

Streams are stored in a SQLite database at `./data/app.db`. The directory is bind-mounted into the
containers (`api` read-write, the workers read-only) so the database survives rebuilds. The file is
created and seeded automatically on first start and is not committed to git (only `data/.gitkeep`
is tracked).

### `settings.json`

The application reads the cron minutes and the retention window from `settings.json` in the root.
The stream list is no longer stored here — it lives in the database and is managed from the admin
screen.

`settings.json` is not in git (it is mounted into the containers as a volume).

Example:

```json
{
  "cleaner": {
    "log_retention": 168,
    "cleaner_minute": 10
  },
  "peakfilegenerator": {
    "peakfile_minute": 5
  },
  "recorder": {
    "recorder_minute": 0
  }
}
```

Fields:

- `recorder.recorder_minute`, `peakfilegenerator.peakfile_minute`, `cleaner.cleaner_minute`:
  the minute of the hour (0–59) at which the respective worker runs.
- `cleaner.log_retention`: retention window for recordings in **hours** (e.g. `168` for seven days).

Streams are managed in the admin screen and stored in the database, not in `settings.json`. Each
stream has a `country`, `name`, `folder`, and `url`; `folder` is the subdirectory under `audio/`
where that station's recordings go, and recording files are named `<folder>/<folder>-YYYY-MM-DD-HH.mp3`.

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
