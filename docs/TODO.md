# audiostreamlogger — TODO & status

Living document for open and future work. The full modernization roadmap and the
whole frontend UI/UX overhaul are done and merged to `origin/main`. For the story of
what was built and why, see [HISTORY.md](HISTORY.md); for how the system fits
together see [ARCHITECTURE.md](ARCHITECTURE.md); for working style and preferences
see [HANDOVER.md](HANDOVER.md).

Last updated: 2026-10-23.

## Current state

Everything shipped is merged and on `origin/main`. Working tree clean. Only the
items below are genuinely open. Completed work (the Mantine UI overhaul, manual
country ordering, the admin content reworks, the player restyle and fixes, the
peak-file model revert, the Refresh-button removal) lives in [HISTORY.md](HISTORY.md).

## Open items

- [x] **Mantine v9 upgrade (done on `mantine9`).** All `@mantine/*` packages moved
      from `8.3.18` to the installed `9.7.5` line as one coordinated upgrade
      (`@mantine/core`, `@mantine/dates`, `@mantine/hooks`), with
      `postcss-preset-mantine` aligned. The lockfile is reproducible (`npm ci`
      clean) and the frontend build + full vitest suite are green on v9. This
      single coordinated upgrade supersedes the split Dependabot PRs #16 and #17
      (which bumped individual Mantine packages piecemeal) — close those as
      done-by-this-upgrade.
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

## New backlog (user, 2026-10-23) — grouped by theme

### Bugs / correctness (fix first)
- [ ] **Recordings sometimes longer/shorter than one hour — happens with AAC
      streams.** The per-hour files are not exactly 1h for AAC. Investigate the
      recorder duration/segmenting for AAC (likely the ADTS copy/transcode path,
      timestamps, or the hour-boundary cut). Use the Graphify graph for impact
      (`graphify explain`/`path` on the recorder record/duration path) before
      reading. Reproduce, then make AAC hours exactly one hour like the other codecs.
- [ ] **At most ONE recording file per hour — no resume / no `.partN` segments.**
      Today a mid-hour stream drop is restarted into a new `<folder>-<stamp>.partN`
      segment (recorder-resilience) because ffmpeg can't cleanly append to an mp3.
      The user wants a single file per hour and NO `.partN` files in the folder.
      DECISION NEEDED (build-time): this is a trade-off — either (a) accept that a
      mid-hour drop leaves a gap (one file, the rest of the hour missing) and drop
      the segment-restart, or (b) keep capturing on drop but MERGE/concat the
      segments into the single `<folder>-<stamp>.<ext>` at hour finalize so the
      folder only ever shows one file. Recommend (b) if we want no data loss;
      confirm with the user. Touches the recorder supervision/segment logic +
      the recordings-row/peak/cleaner assumptions about one file per hour.
- [ ] **"Move station up" must not cross the country boundary.** In the admin
      streams list, the up/down arrows for a STATION should clamp at the top/bottom
      position WITHIN its country group (not jump into the adjacent country). The
      COUNTRY up/down buttons already clamp correctly — mirror that behavior for the
      per-station reorder. Frontend (StreamTable reorder) + the reorder persistence.

### Config / recording features
- [ ] **Per-stream retention instead of one global retention.** Each stream gets
      its own log-retention window; the cleaner uses the per-stream value instead of
      the single global `log_retention`. Additive schema (a retention column on
      `streams`, falling back to the global default when unset) + the cleaner reading
      per-stream + the admin UI (a retention field per stream, likely in the stream
      row/editor). Keep the global as the default/fallback.
- [ ] **Schedulable recording period per stream (future start + end date).** Allow a
      stream to be recorded only during a chosen PERIOD — a start (possibly in the
      future) and an end date — rather than always-on. The recorder only records a
      stream while "now" is within its window; outside the window it doesn't capture.
      Additive schema (start/end on `streams`, nullable = always-on) + recorder
      honoring it + admin UI. Consider how this interacts with catch-up and the
      new-stream poll.

### DB
- [ ] **DB optimizations.** Review the SQLite schema/queries for indexes and query
      shape (e.g. the recordings/analysis/health/storage queries, the jobs/schedules
      polling). Add missing indexes, tighten hot queries. Use Graphify + EXPLAIN
      QUERY PLAN to target the real hot paths; additive/index-only, no destructive
      migration. (Scope to be refined — gather the actual slow/among-frequent queries
      first.)

### Admin UI structure
- [ ] **Recordings & Health in the same order/structure as the Streams tab.** The
      merged Recordings & Health table should present streams in the SAME order as
      the Streams tab (i.e. honor the manual stream `sort_order` + `country_order`
      grouping), so the two tabs line up. Frontend-only (ordering/grouping of the
      RecordingsHealth rows, reusing the country-order + sort_order helpers).

### Notifications
- [ ] **Build in notifications.** (NEEDS CLARIFICATION — see the question relayed to
      the user.) Unclear yet: notify about WHAT (e.g. a stream going down / a failed
      recording / a job failure / disk filling up?), to WHOM, and via WHICH channel
      (in-app banner, email, the existing Telegram bot, web push?). Decide the trigger
      events + channel before building. Placeholder until the user specifies.

### Big feature — frontend auth + user management + long-term saved hours
- [ ] **Frontend login + user management + per-user saved/starred hours.** A large,
      multi-part feature:
      - A **frontend login screen** so the player/admin is per-user (today only the
        admin screen is login-gated with a single seeded admin).
      - **User management in the backend**: multiple users. The user wants to AVOID
        storing passwords where possible — support **OAuth via Gmail (Google) and
        Outlook (Microsoft)** as sign-in, AND still allow a **local user**. So: both
        local accounts and Google/Microsoft OAuth users can be granted access.
      - **Per-user long-term saved hours**: a separate place where chosen hours are
        kept for the long term (exempt from the retention cleaner). Mechanism idea:
        a **star** toggle on an hour in the frontend; starred hours are preserved.
        Because it's per-user, it hangs off the login/user-management above.
      DECISIONS NEEDED (build-time): the OAuth provider setup (Google + Microsoft
      OAuth apps, redirect URIs, client id/secret in `.env`), how a local user +
      OAuth users coexist in the `users` table, session model, which routes become
      user-gated vs public, and whether "starred/long-term" hours are a per-user set
      of (stream, date, hour) that the cleaner must skip + the storage/retention
      interaction. This is big enough for its own design-first workflow (likely split
      into: auth/OAuth + user model, then per-user starred-hours + cleaner exemption,
      then the frontend login + star UI). Do NOT start without a design pass.

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
