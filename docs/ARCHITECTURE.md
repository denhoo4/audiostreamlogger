# Architecture

audiostreamlogger is a four-service Docker Compose application that records
internet audio streams hourly, generates waveform peak files, prunes old
recordings, and serves a web UI to browse, play, and download them. This
document describes how the services fit together, where configuration lives, and
how to run and test the stack. For day-to-day usage see [README.md](../README.md);
for the testing approach see [TESTING.md](TESTING.md).

## Services

All source lives under `src/`. Every service runs on `node:26-bookworm` (the
frontend builds on it and serves through `nginx:1.27-bookworm`).

### recorder (`src/recorder/`)

Records every configured stream once an hour with ffmpeg, supervising each
stream's ffmpeg process independently so a single drop does not disturb the
others (a mid-hour restart writes a `.partN` segment with capped backoff).
On startup and on a periodic poll it **catches up** the remaining part of the
current hour for any stream with no recording yet, so a newly-added stream starts
recording immediately. It reads its run minute from the database and writes a
`recordings` row per captured hour-slot (status `recording` → `complete`/`partial`
plus size). It shuts down cleanly on SIGTERM/SIGINT.

**Codec & copy-vs-transcode.** Each stream records in its configured codec
(`mp3`/`opus`/`aac`/`flac`; the on-disk extension equals the codec, and `aac` is
raw ADTS written with an explicit `-f adts` muxer). Before each hour the recorder
runs a bounded ffprobe source-detect (which resolves `null` on any failure and
never blocks startup): when the detected source codec equals the configured codec
**and** the container is copy-eligible (`mp3` in an `mp3` format, `aac` in an
`aac`/`adts` format), it records with `-c:a copy` — storing the source bytes
verbatim with no resample and **ignoring** the configured bitrate. Otherwise it
transcodes to the configured codec/bitrate (`opus`/`flac` always transcode). The
async probe window is SIGTERM-safe: a shutdown signal arriving mid-probe aborts the
stream without crashing the graceful-shutdown loop.

### worker (`src/worker/`)

A generic job runner. It polls the `jobs` table and executes **one job at a time**
across all types:

- **cleaner** — deletes recordings past the retention window and removes the
  matching `recordings` row.
- **peakfilegenerator** — generates `audiowaveform` peak files for the player. It
  peaks **only completed hours** and skips the current in-progress hour: the browser
  decodes the live hour's waveform client-side (see the peak-file model below).
- **reconcile** — a two-way disk↔DB sync: inserts missing `recordings` rows, removes
  orphans, and fixes drifted status/segment counts. Schedulable like the others, with
  a Run-now control in the admin Jobs tab.

It replaces the old standalone `cleaner` + `peakfilegenerator` containers. It
also fills each `recordings` row's duration/size (ffprobe) after processing a
file. A job that would overlap a running one is skipped ("skipped, busy").

**Peak-file model.** Completed hours are peaked once by the worker's
`peakfilegenerator` run and the player loads that `.json`. The current, still-growing
hour is **not** peaked by the backend — the player decodes it client-side from the
audio (cache-busted on Load). An earlier experiment (item 24) that regenerated the
current hour's peak file live on a worker timer was **reverted**: it produced a short
peak file stretched across the full hour. The `currenthourpeaks` handler and its
timer no longer exist.

`mp3`/`opus`/`flac` hours are peaked by running `audiowaveform` directly on the
recording. `aac` hours use a **decode-to-WAV pipe** instead
(`ffmpeg -i <file> -f wav - | audiowaveform --input-format wav -i - -o <json>`,
with the spawn buffer sized for the ~635 MB/hour decoded WAV), because
`audiowaveform` 1.10.2 cannot read a raw ADTS `.aac` file directly. The resulting
`.json` is shape-identical across every codec, so the player is codec-agnostic.

### api (`src/api/`)

The Express service and **owner of the database**. It:

- owns the SQLite schema and every config/stream/job/schedule write;
- handles authentication (login/logout/me/change-password) over a server-side,
  revocable SQLite-backed session store;
- serves the public stream list (`GET /api/settings`) and the recordings browse
  tree (`GET /api/settings2`), plus stream CRUD behind `requireAuth`;
- runs the advisory **Test** probe (`POST /api/streams/test-url`): besides
  reachability it ffprobes a confirmed terminal 2xx for the source codec/bitrate
  and returns a `suggested` quality the admin Streams editor pre-fills (the
  detected codec snapped to its allowed bitrate, or an `mp3`/192 fallback when the
  codec is unknown/undetected) — the user can still override and the probe never
  persists anything;
- exposes the recordings analysis endpoints (`GET /api/analysis/summary` and
  `/api/analysis/gaps`, both `requireAuth`);
- exposes backup export/import (`/api/backup/*`, `requireAuth`);
- streams a live job feed over Server-Sent Events;
- hosts the DB-driven **scheduler** that enqueues jobs on each type's schedule;
- runs a one-time startup backfill that reconciles existing audio files into
  `recordings` rows.

It listens internally on port 3000 and is **not** published to the host.

### frontend (`src/frontend/`)

A React + Vite single-page app, built to static assets and served by nginx. The
same nginx config serves the recorded audio under `/audio` and
reverse-proxies `/api`, `/util`, and `/auth` to the api service, so the whole app
is **same-origin** (no CORS). The admin screen lives at `/settings`.

UI styling is built on **Mantine** (`@mantine/core` + `@mantine/hooks`, plus
`@mantine/dates` for the player calendar and `@tabler/icons-react`), with a
Google-AI-Studio-inspired look configured through a `MantineProvider` +
`src/theme.ts` token set. The app **follows the device light/dark setting**
(`defaultColorScheme="auto"` with `ColorSchemeScript` to avoid a flash) and switches
live; there is no manual toggle. A small custom `systemColorSchemeManager` keeps
Mantine from pinning the scheme to a stale `localStorage` value so "follow the
browser" always wins. A thin shared `src/ui/` layer (`Panel`, `StatusBadge`,
`AsyncState`) carries the house conventions. The header brand name is driven by the
configured `app_title`. The player's stream picker groups stations under
non-selectable country `<optgroup>` headers in the configured country order.

## How the services communicate

```
            ┌───────────── browser ─────────────┐
            │  /  (player)      /settings (admin) │
            └───────────────────┬────────────────┘
                                 │  http (host PORT, default 9703)
                        ┌────────▼────────┐
                        │  frontend/nginx │  serves SPA + /audio,
                        │                 │  proxies /api,/util,/auth
                        └────────┬────────┘
                                 │  http://api:3000 (compose network)
                        ┌────────▼────────┐
                        │       api       │  owns app.db (schema/config/
                        │  + scheduler    │  streams/jobs/sessions)
                        └────────┬────────┘
                   enqueues jobs │ via the DB (no HTTP)
      ┌──────────────────────────┼──────────────────────────┐
      │                          │                           │
┌─────▼─────┐             ┌──────▼──────┐             ┌───────▼───────┐
│  recorder │             │   worker    │             │   ./data      │
│ writes    │  ◄────────► │ cleaner +   │  ◄────────► │  app.db       │
│ audio+rows│   shared    │ peakfiles + │   shared    │ (SQLite file) │
│           │   ./audio   │ reconcile   │   ./data    │               │
└───────────┘             └─────────────┘             └───────────────┘
```

The backend services never talk over HTTP; they coordinate through the shared
`./data/app.db` file and the shared `./audio` volume. `recorder`, `worker`, and
`api` all mount `./data` read-write — the api owns every schema/config write
while the worker and recorder each open a scoped read-write handle for job status
and `recordings` rows.

## Where configuration lives

**There is no `settings.json`** — it was removed entirely. All configuration is
in the SQLite database at `./data/app.db`:

- `streams` — the stream list (`country`, `name`, `folder`, `url`), each with a
  per-stream codec (`mp3`/`opus`/`aac`/`flac`) + bitrate/bit-depth, a `sort_order`, and a
  `default_stream_folder` the player preselects.
- `schedules` — per job type (`cleaner`, `peakfilegenerator`, `reconcile`) enable
  toggle + hourly/daily/weekly schedule.
- `app_config` — scalar key/value settings: the recorder run minute, the
  log-retention window (`log_retention`), output-retention count, the page title
  (`app_title`), the `favicon`, the manual `country_order` (a JSON array of ISO
  alpha-2 codes the player and admin Streams table honour), and the worker's
  informational heartbeat/status rows.

The database is created and seeded automatically on first start (a single admin
user `admin` / `admin`, and the default schedules/config). The `./data` directory
is bind-mounted so the DB survives rebuilds; only `data/.gitkeep` is tracked in
git.

Host-level configuration lives in `.env` (copied from `.env.example`): `PORT`
(published web port, default 9703), `SESSION_SECRET` (cookie signing secret; an
insecure dev fallback is used with a warning if unset), and `COOKIE_SECURE`.

## Data volume & backup

- `./audio` — recordings under `audio/<folder>/<folder>-YYYY-MM-DD-HH.<ext>`
  (timezone `Europe/Amsterdam`), where `<ext>` is the stream's codec
  (`mp3`/`opus`/`aac`/`flac`). Completed hours carry a `.json` peak file for the waveform;
  the current in-progress hour is decoded client-side.
- `./data/app.db` — the single SQLite database described above.

From the admin screen (all `requireAuth`): **export** a JSON backup of streams +
an allowlist of safe config, or download the raw DB file; **import** a JSON
backup back. Import upserts streams by `folder` and applies only allowlisted
config keys — it **never** touches users or sessions.

## How to run

```sh
cp .env.example .env     # adjust PORT if desired
docker compose up --build
```

Open `http://localhost:<PORT>` (default `http://localhost:9703`); the admin
screen is at `/settings`, seeded with `admin` / `admin` (change the password
after first login).

## How to run tests

See [TESTING.md](TESTING.md). In short: `node --test` per backend
service (`src/api`, `src/worker`, `src/recorder`) and `vitest` for the frontend;
the images install deps with `npm ci` against the committed lockfiles.

## Continuous integration & dependency updates

- `.github/workflows/ci.yml` runs on every push and pull request: it installs
  and tests each backend service (matrix over api/worker/recorder on Node 26),
  builds + tests the frontend, and runs `docker compose build` of all four
  services. Coverage runs report-only (non-blocking).
- `.github/dependabot.yml` opens weekly update PRs for the npm dependencies in
  each service, the Docker base images, and the GitHub Actions. **Base-image
  updates arrive as PRs**: `node:26-bookworm` and `nginx:1.27-bookworm` get
  digest/minor bumps, and a major jump (for example `node:26` → `node:27`) also
  surfaces as a PR to review rather than being applied silently.
