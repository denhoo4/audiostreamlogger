# audiostreamlogger — TODO & status

Living document for open and future work. The full modernization roadmap is done
and merged to `origin/main`. For the story of what was built and why, see
[HISTORY.md](HISTORY.md); for how the system fits together see
[ARCHITECTURE.md](ARCHITECTURE.md); for working style and preferences see
[HANDOVER.md](HANDOVER.md).

Last updated: 2026-10-23.

## Current state

Everything shipped is merged and on `origin/main`. Working tree clean. Only the
items below are genuinely open.

## Open items

### Dependabot frontend-toolchain upgrade — awaiting merge/finalize
The bundled React 19 / Vite 8 / Vitest 5 / `@vitejs/plugin-react` 6 upgrade is
coded, verified green in `node:26-bookworm`, and the semantic review is approved on
branch `frontend-toolchain-upgrade`. It is NOT yet merged. The merge/finalize step
merges it and closes the superseded individual Dependabot PRs
(#4/#6/#8/#10/#11/#12). The four green standalone PRs (#3 nginx, #5 jsdom, #7
github-actions, #9 argon2) are already merged onto that branch.

### Wavesurfer: scroll-to-zoom at the cursor (item 13)
Mouse-wheel scroll on the waveform should zoom in/out centered on the point under
the cursor (zoom toward the pointer, not a global zoom). Frontend-only, touches the
`useWavesurfer` hook. In progress on the `wavesurfer-zoom` worktree: keep the legacy
direction/step/clamp (5 px/sec per event, deltaY sign only, lower-clamp 0, no upper
clamp, `zoom(minPxPerSec)` units) but add cursor-x anchoring via the v7 scroll math,
with a pure `nextZoom(current, deltaY)` helper so step/clamp stay unit-testable.

### Full frontend UI/UX overhaul — DEFERRED
The user explicitly wants a proper UI/UX pass later, not now. Styling has been kept
intentionally minimal (including the 4-tab admin layout) until this is picked up.

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
