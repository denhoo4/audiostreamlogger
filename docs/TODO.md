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

These three are in flight from the latest batch and are being worked separately:

- [ ] **AAC stream support + Test auto-detect.** Add AAC as a recordable codec in
      its own container (alongside mp3/opus/flac). When adding a stream and pressing
      Test, pre-fill the codec/bitrate fields from the stream's detected native
      format (e.g. AAC 192 kbps), while leaving the user free to override. Fall back
      to MP3 192 kbps when the detected format is unsupported. AAC is only worth
      shipping if the peak-file generator works for it too, so it matches the other
      codecs' experience.
- [x] **Mobile player button layout.** On a mobile device the player controls wrap
      unattractively. Lay them out more symmetrically and keep the play/pause button
      in a stable centre position. Done: the transport zone is now three centred
      zones (rewind skips | play/pause | forward skips), each skip zone an
      equal-flex group that wraps internally so the negative and positive skips
      stay balanced around the always-centred play/pause at narrow widths.
- [ ] **Mobile current-hour seek bug.** On a mobile device the current (in-progress)
      hour can only be played from the start and the skip buttons do nothing; older
      completed files work fine. Likely tied to the current-hour peak/decoding path.
      Note it does not reproduce in a desktop browser scaled to phone dimensions.

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
