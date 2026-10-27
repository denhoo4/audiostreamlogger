# audiostreamlogger

Records internet radio streams every hour, draws their waveforms, tidies up after
itself, and serves a web UI to browse, play, and download the lot. It is a
four-service Docker Compose stack, so your laptop fan does the worrying, not you.

- **What it is:** a radio DVR for the internet. Point it at a list of stream URLs,
  and every hour it captures each one, generates a waveform peak file, prunes
  recordings past your retention window, and shows it all in a browser.
- **What runs it:** four services under `src/` — see the table below.

For the why and how see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); for running
the tests see [docs/TESTING.md](docs/TESTING.md).

## The services

| Service | Role |
| --- | --- |
| `recorder` | Records each stream once an hour with ffmpeg; supervises each stream independently and catches up a newly-added stream mid-hour. |
| `worker` | Runs one job at a time: cleaner (prune old recordings), peakfilegenerator (waveforms), reconcile (sync disk ↔ DB). |
| `api` | Express backend; owns the SQLite database, auth, the admin screen's endpoints, the scheduler, and OpenAPI docs. Internal only. |
| `frontend` | React + Vite SPA served by nginx, which also serves `/audio` and proxies the api (same-origin, no CORS). |

All configuration lives in a SQLite database at `./data/app.db`. There is no
`settings.json` — it went to a better place, which is to say the database.

## Requirements

- Docker
- Docker Compose v2 (the `docker compose` subcommand)

That's the whole list. No Node, no ffmpeg, no audiowaveform on the host — the
images bring their own.

## Install and run

1. Clone the repo:

   ```sh
   git clone https://github.com/denhoo4/audiostreamlogger.git
   cd audiostreamlogger
   ```

2. Copy the env template and adjust it:

   ```sh
   cp .env.example .env
   ```

   Three keys matter:

   - `PORT` — host port the web UI is published on (default `9703`).
   - `SESSION_SECRET` — signs session cookies. Set a real value; if you leave it
     empty the api falls back to an insecure dev secret and tells you so, loudly.
   - `COOKIE_SECURE` — set to `true` only once you serve over HTTPS; leave `false`
     for plain-http development.

3. Build and start the stack:

   ```sh
   docker compose up --build
   ```

4. Open the web UI at `http://localhost:9703` (or whatever `PORT` you set).

5. The admin screen is at `/settings`. On a fresh database it is seeded with a
   single admin account — username `admin`, password `admin`. Change that password
   immediately, before someone with better taste in passwords does it for you.

## Stopping

`Ctrl+C` in the terminal running `docker compose up`, or:

```sh
docker compose down
```

## What you can do from `/settings`

Add/edit/remove streams (with per-stream codec, manual stream and country
ordering, and a default stream), set branding, schedule and run jobs, watch a
live job feed, review recording analysis and stream health, see a storage
estimate, and export/import a backup.
Full detail lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

The longer-form docs live in [`docs/`](docs/):

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the four services fit
  together, where configuration lives, and how to run it.
- [docs/HISTORY.md](docs/HISTORY.md) — the story of what was built and why the
  big decisions went the way they did.
- [docs/TODO.md](docs/TODO.md) — what is still open right now.
- [docs/HANDOVER.md](docs/HANDOVER.md) — working style, preferences, and
  environment gotchas for the next developer.
- [docs/TESTING.md](docs/TESTING.md) — the testing strategy and the exact
  commands CI runs.

## Data on disk

- `./audio/<folder>/<folder>-YYYY-MM-DD-HH.<ext>` — recordings (timezone
  `Europe/Amsterdam`), each with a `.json` peak file. `<ext>` is the stream's codec
  (`mp3`/`opus`/`aac`/`flac`).
- `./data/app.db` — the one SQLite database. Bind-mounted, so it survives rebuilds.
  Only `data/.gitkeep` is tracked in git.

## Development & tests

Run the suites with `node --test` per backend service and `vitest` for the
frontend — inside Docker, since the host has no Node. See
[docs/TESTING.md](docs/TESTING.md) for the exact commands and the unit-vs-integration
split. CI (`.github/workflows/ci.yml`) runs the same on every push and PR and builds
all four images.

Good luck!
