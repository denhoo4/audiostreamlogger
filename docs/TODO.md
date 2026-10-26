# audiostreamlogger — TODO & status

Living document for open and future work. The full modernization roadmap and the
whole frontend UI/UX overhaul are done and merged to `origin/main`. For the story of
what was built and why, see [HISTORY.md](HISTORY.md); for how the system fits
together see [ARCHITECTURE.md](ARCHITECTURE.md); for working style and preferences
see [HANDOVER.md](HANDOVER.md).

Last updated: 2026-10-26.

## Current state

Everything shipped is merged and on `origin/main`. Working tree clean. Only the
items below are genuinely open. Completed work (the Mantine UI overhaul, manual
country ordering, the admin content reworks, the player restyle and fixes, the
peak-file model revert, the Refresh-button removal) lives in [HISTORY.md](HISTORY.md).

## Open items

- [x] **AAC stream support + Test auto-detect (done on `aac-copy-support`).** AAC
      is now a first-class recordable codec alongside mp3/opus/flac (raw ADTS
      `.aac`, lossy bitrate set `[96,128,160,192,256,320]`). Full stack:
      - **API** — `aac` validates like any lossy codec; a pure `lib/codec-detect.js`
        owns copy-eligibility / bitrate-snap / suggestion, and the Test probe
        (`lib/probe-stream-url.js`) runs an injectable `ffprobe` seam on a terminal
        2xx to return `detectedCodec` / `detectedBitrateKbps` / `formatName` /
        `suggested` (mp3/192 fallback).
      - **Recorder** — records in the configured codec and **copies** the source
        bytes (`-c:a copy`, no resample, configured bitrate ignored) only when the
        detected source codec equals the configured codec and the container is
        copy-eligible (mp3/`mp3`, aac/`aac`|`adts`); otherwise it transcodes. The
        ffprobe detect is bounded and SIGTERM-safe.
      - **Worker** — `.aac` is recognized everywhere audio extensions are
        enumerated and peaked via a decode-to-WAV pipe (audiowaveform 1.10.2 can't
        read raw ADTS directly); mp3/opus/flac keep the direct path.
      - **Frontend** — `aac` is a `Codec` + `CODEC_OPTIONS` entry; a successful Test
        pre-fills the editor codec/bitrate from `suggested` (snapped to the codec's
        set, mp3/192 fallback for an unknown codec), leaving the user free to
        override; the probe still never saves.
      All four suites pass with the new cases, and the real-image AAC
      encode/copy/peak-pipe/transcode smokes are green.
- [x] **Mobile player button layout.** On a mobile device the player controls wrap
      unattractively. Lay them out more symmetrically and keep the play/pause button
      in a stable centre position. Done: the transport zone is now three centred
      zones (rewind skips | play/pause | forward skips), each skip zone an
      equal-flex group that wraps internally so the negative and positive skips
      stay balanced around the always-centred play/pause at narrow widths.
- [x] **Mobile current-hour seek bug (primary fix on `mobile-seek-fix`).** On a
      mobile device the current (in-progress) hour could only be played from the
      start and the skip buttons did nothing; completed files worked. Root cause:
      the live hour is a growing, header-less MP3 whose media duration is
      Infinity/unknown on mobile, so WaveSurfer's `media.currentTime` seeks were
      dropped. Fix (frontend only): a pure `liveHourElapsedSeconds()` helper
      derives the current hour's length from the Amsterdam wall clock and is passed
      to WaveSurfer as an explicit `load(url, undefined, duration)` for the live
      hour (recomputed each reload/poll), giving getDuration/seekTo/skip a finite
      timeline; past hours keep their precomputed-peaks path unchanged. Verified
      green in the vitest suite. RESIDUAL FOLLOW-UP: an explicit duration fixes
      WaveSurfer's math but the mobile `<audio>` element may still refuse to
      physically seek a growing header-less file — needs an on-device check; if it
      still won't seek, escalate to serving a header-stamped/finalized live-hour
      snapshot (backend, not done here). See
      `.agents/tasks/mobile-seek-verification.md`.

## Remaining tech debt (lower priority)

- [ ] Duplicated settings read + minute validation across services, with diverging
      bounds and messages. Fix: one shared `loadSettings()` + `validateMinute()`
      module. (Largely mooted by the DB migration, but the shared-validation nit
      remains.)

## Known failure modes / environment notes

Operational notes that still bite in practice:

- **Rebuild the whole stack after a frontend/api change** (`docker compose up -d
  --build`), not a single service. A stale image once rendered an "undefined"
  Stream Health panel.
- **New recorder/worker modules need a matching `COPY` line** in their Dockerfile —
  those images copy source files individually. A missing `COPY folder-utils.js`
  crashed the recorder at boot in production. Verify with a real `docker build`, not
  just `node --test`.
- The host has **no Node**: all node/npm/build/test runs happen inside the
  `node:26-bookworm` image and the service images (for ffmpeg/audiowaveform).
- A **live production stack runs on host port 9703** — never bind 9703 and never
  touch repo-root `./audio` or `./data`. Smoke tests use a throwaway temp dir, an
  alternate port, and `-p <project>`, and tear down with `docker compose down` (no
  `-v`).
- `.env` is gitignored; `.env.example` is the committed template. The running stack
  needs a real `SESSION_SECRET` or it falls back to an insecure dev secret with a
  warning.

(Working-style and process notes now live in [HANDOVER.md](HANDOVER.md).)
