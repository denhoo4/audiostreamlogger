# audiostreamlogger — TODO & status

Living document for open and future work. The full modernization roadmap and the
whole frontend UI/UX overhaul are done and merged to `origin/main`. For the story of
what was built and why, see [HISTORY.md](HISTORY.md); for how the system fits
together see [ARCHITECTURE.md](ARCHITECTURE.md); for working style and preferences
see [HANDOVER.md](HANDOVER.md).

Last updated: 2026-10-23 (recorder-hour-resilience Phases 1+2 / FEAT-002 recorder core landed).

## Current state

Everything shipped is merged and on `origin/main`. Working tree clean. Only the
items below are genuinely open. Completed work (the Mantine UI overhaul, manual
country ordering, the admin content reworks, the player restyle and fixes, the
peak-file model revert, the Refresh-button removal) lives in [HISTORY.md](HISTORY.md).

## Open items

- [x] **wavesurfer.js v8 upgrade (done on `wavesurfer8`).** The player's
      `wavesurfer.js` moved from `7.12.12` to `8.0.5` (Dependabot PR #15) — the
      only dependency change (its regions plugin ships from the same package,
      unchanged import path `wavesurfer.js/dist/plugins/regions.esm.js`). This is
      a MAJOR bump but the public surface this app uses is unchanged: verified
      against the installed v8.0.5 `.d.ts` that `create`/`registerPlugin`/
      `load(url, channelData?, duration?)`/`zoom`/`skip`/`seekTo`/`setTime`/
      `getDuration`/`getCurrentTime`/`getWrapper`/`getScroll` and the regions
      `addRegion`/`clearRegions`/`setOptions`/`start`/`end` all keep their v7
      names and signatures. The three real v8 semantics (`load()` now returns a
      `Promise<void>` that rejects with AbortError on supersession — relevant to
      the live-hour poll, kept fire-and-forget; `getMediaElement()` can return
      null under WebAudio — not called here; `peaks` type widened — assignable)
      are documented in `useWavesurfer.ts` and needed no code change beyond
      comments. The vitest WaveSurfer/Regions mock was migrated to the v8 shape
      (load/play/playPause return promises; region.play(stopAtEnd?)) without
      weakening any behavioral assertion. The lockfile is reproducible (`npm ci`
      clean) and the frontend build + full vitest suite are green on v8 (149
      tests, same as the v7 baseline). Runtime behaviors that the mocked suite
      cannot prove require a browser check — see
      `.agents/tasks/audiostreamlogger-wavesurfer8-2026-10-23/verification.md`.
- [x] **TypeScript 7.0.2 upgrade (merged to `main`, PR #14).** The frontend
      `typescript` devDependency moved from `5.9.3` to `7.0.2` (Dependabot PR #14) —
      the native Go-based `tsgo` compiler. The npm `typescript@7.0.2` package ships
      `bin/tsc` plus 20 per-platform optional binaries under
      `@typescript/typescript-<os>-<arch>` (linux-x64 selected in Docker/CI); `tsc`
      is invoked exactly as before, so the unchanged `tsc -b && vite build` script
      works as-is. No source changes and no type fixes were needed. Verified clean:
      `npm ci` reproducible, a full `tsc -b --force` type-check passes with zero
      errors, `vite build` emits a byte-identical bundle, and the full vitest suite
      is green (149 tests, same baseline). The build/test toolchain (vite 8,
      `@vitejs/plugin-react`, vitest) does its type-stripping via esbuild/rolldown
      and does not consume the TypeScript compiler API, so TS 7's API-compat caveats
      don't apply here; CI needs no change. See
      `.agents/tasks/audiostreamlogger-typescript7-2026-10-23/verification.md`.
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
- [ ] **DESIGN-FIRST: "Hour completeness & recorder-lifecycle resilience" — one
      coordinated design for ALL the partial/half-hour edge cases (user, 2026-10-23).**
      The user wants every "an hour isn't a full hour" cause designed together, once,
      instead of patched piecemeal, because they are the same problem (the recorder
      being interrupted or mis-cutting the hour). Collect and design for:
      1. **Auto-deploy restarts (NEW, the main real-world cause).** The user runs a
         cronjob every 10 minutes that `git pull`s and `docker compose up -d` when a
         new version exists — which RESTARTS the recorder container MID-HOUR on every
         deploy, truncating the in-progress recording. The design must make the
         recorder survive/resume across a restart so a deploy doesn't leave a half
         hour: e.g. on startup, if a recording for the current hour already exists
         but is short, RESUME/continue capturing the remainder of the current hour
         (the existing startup catch-up records the remainder only when NO file
         exists — extend it to top up a truncated current-hour file), and/or MERGE
         the pre-restart partial with the post-restart remainder into one file at
         hour finalize. Consider a graceful-shutdown handoff so compose stop → start
         loses as little as possible.
      2. **Mid-hour stream drops / `.partN` segments.** A dropped stream is currently
         restarted into `<folder>-<stamp>.partN` (recorder-resilience). The user wants
         a SINGLE file per hour and NO `.partN` files. DECISION NEEDED: (a) accept a
         gap on drop (one file, remainder missing) vs (b) keep capturing on drop then
         MERGE/concat segments into the single `<folder>-<stamp>.<ext>` at hour
         finalize (recommended if no data loss wanted). This is the same merge
         machinery the deploy-restart case needs — design them together.
      3. **AAC hours longer/shorter than one hour.** Per-hour AAC files aren't exactly
         1h (likely the ADTS copy/transcode timestamps or the hour-boundary cut).
         Make AAC hours exactly one hour like the other codecs. May share the
         hour-boundary cutting logic the above cases touch.
      4. **The "one file per hour" invariant everywhere.** Once segments are merged /
         resumes are stitched, the recordings-row / peak-generation / cleaner /
         reconcile / player assumptions should see exactly ONE file per (stream, hour)
         with ~3600s duration. Audit those consumers so they match the new invariant.
      Approach: DESIGN-FIRST workflow (Graphify-driven impact on the recorder
      record/duration/segment/catch-up + the recordings/peak/cleaner consumers)
      resolving the (a)/(b) decision and the restart-resume/merge mechanism, THEN
      implement. Do NOT patch these as three separate quick fixes — they share the
      hour-boundary + segment-merge + resume-on-restart machinery and must be one
      coherent design. (Note: the auto-deploy restart is operational, not a code bug,
      but the recorder should be resilient to it; also worth telling the user a
      zero-downtime recorder deploy or a drain-before-restart could reduce the cut.)
      - IN PROGRESS on branch `recorder-hour-resilience` (design under
        `.agents/tasks/audiostreamlogger-recorder-hour-resilience-2026-10-23/`).
        Phase 0 (FEAT-001) DONE: the finalise primitive — a pure
        `buildTimeline(fragments, hourSeconds=3600)` that tiles the hour and
        inserts silence for every gap, plus a `finalizeHour(workDir, outPath, enc,
        {segments})` ffmpeg runner (concat-with-silence path for mp3/opus/flac and
        AAC-with-gap, AAC no-gap copy-remux fast path with no resample). Pure argv
        builders, array-only ffmpeg options. New files `src/recorder/finalize-timeline.js`
        + `finalize-hour.js` (shipped via Dockerfile.recorder); not wired into the
        recorder yet (later phases stitch resumes/merges onto this engine). Note:
        raw ADTS `.aac` hours have no container duration — verify AAC hour length by
        counting frames, not `ffprobe format=duration`.
        Phase 1+2 (FEAT-002) DONE: the recorder core is now wired onto that
        engine. Capture routes through a hidden per-hour work dir
        `audio/<folder>/.inprogress/<stamp>/` writing offset-named fragments
        (`<startOffset>-<attempt>.<ext>`) plus an atomic `state.json` sidecar;
        the primary `<folder>-<stamp>.<ext>` is written ONLY by an idempotent,
        mutex-guarded `finalizeIfNeeded` (triggered by ffmpeg-end, a cron
        past-hour backstop, and a boot resume pass) that lays the fragments on
        the 3600s timeline and fills gaps/down-windows with silence — so a
        mid-hour drop or an update reboot yields exactly ONE ~3600s file with
        silence for the gap, no more `.partN` files. New `src/recorder/inprogress.js`
        (shipped via Dockerfile.recorder) + pure `elapsedThisHour` (time-helpers)
        + pure `currentHourDecision` (catchup-helpers). `.inprogress` is a
        dotfile excluded from every audio-tree walk (reconcile/peakgen/cleaner/
        backfill) via a new `isIgnoredEntry`. Still open on this branch: the
        gap/completeness flag surfaced to the UI (FEAT-004) and later phases.
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
