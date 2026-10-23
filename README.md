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
| `api` | `src/api/` | Express API: serves the stream list and the recordings browse tree, and handles cutting/downloading fragments. Runs internally on port 3000, not public. |
| `frontend` | `src/frontend/` | React + Vite single-page app, served by nginx. nginx also serves the audio and reverse-proxies `/api` + `/util` to the `api` service (same-origin, so no CORS needed). |

The `recorder`, `cleaner`, and `peakfilegenerator` are cron-based workers that run at a configured
minute of each hour. Audio is shared via a volume (`./audio`).

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

3. Provide a `settings.json` in the root (see "Configuration" below).

4. Build and run the application:

   ```sh
   docker compose up --build
   ```

5. Open the web interface at `http://localhost:<PORT>` (default `http://localhost:9703`).

## Stopping

In the terminal running `docker compose up`: `Ctrl+C`. Or, to stop and clean up the containers:

```sh
docker compose down
```

## Configuration

### `.env`

The web interface port is set in `.env`:

```
PORT=9703
```

The real `.env` is not in git; use `.env.example` as a template.

### `settings.json`

The application reads its configuration from `settings.json` in the root. This file specifies the
streams to record and the minute-of-the-hour each worker runs at, plus the retention window for
recordings.

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
  },
  "streams": [
    {
      "country": "Netherlands",
      "name": "Glow_FM",
      "folder": "glowfm",
      "url": "https://stream.glowfm.nl/glowfm.mp3"
    },
    {
      "country": "Netherlands",
      "name": "RTV_Connect",
      "folder": "rtvconnect",
      "url": "https://stream.rtvconnect.nl/radio/8000/ffm-320-mp3"
    }
  ]
}
```

Fields:

- `recorder.recorder_minute`, `peakfilegenerator.peakfile_minute`, `cleaner.cleaner_minute`:
  the minute of the hour (0–59) at which the respective worker runs.
- `cleaner.log_retention`: retention window for recordings in **hours** (e.g. `168` for seven days).
- `streams`: the stations to record. `folder` is the subdirectory under `audio/` where that
  station's recordings go; recording files are named `<folder>/<folder>-YYYY-MM-DD-HH.mp3`.

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

> **Note:** this project is under active development. A database-backed management screen (with
> login) for the streams and configuration is being built; this README describes the current
> `settings.json`-based setup and will be updated once that lands.
