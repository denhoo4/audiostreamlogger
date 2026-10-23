# Handover — audiostreamlogger (2026-10-23)

A quick-start briefing to resume work in a fresh chat/session. For the full task history and the
prioritized backlog see `TODO.md`; for how the system fits together see `ARCHITECTURE.md`.

## Where things stand

The big modernization roadmap is COMPLETE and everything is merged + pushed to `origin/main`
(tip `d16304a`). `main` == `origin/main`, working tree clean, no open worktrees/branches of ours.

Done and live:
- Node 26 Docker stack, 4 services: **recorder, worker, api, frontend** (the old `cleaner` and
  `peakfilegenerator` containers are gone — folded into the generic `worker`).
- **No `settings.json`** — all config is in a SQLite DB at `./data/app.db`.
- React+Vite+TS frontend (wavesurfer v7 + scroll-to-zoom); player at `/`, login-gated admin at
  `/settings` (seeded `admin`/`admin`).
- SQLite DB (node:sqlite, journal_mode=DELETE) with tables: streams, users, sessions, jobs,
  schedules, app_config, recordings. Argon2id auth + server-side session store.
- Job queue + DB scheduler (hourly/daily/weekly, global single-job busy=SKIP), SSE live job view.
- recordings table + analysis endpoints + admin analysis view.
- Recorder resilience (per-stream supervision, graceful shutdown, 30s new-stream catch-up poll).
- Admin branding (title + favicon), worker status, existing-hours selector, DB backup/import.
- Tests + CI + Dependabot + ARCHITECTURE.md/docs/TESTING.md.

## Environment notes (important for a fresh session)

- **Host has no Node and no `gh` was installed until 2026-10-23.** `gh` is now installed AND
  authenticated as GitHub user `denhoo4` (keyring). Backend tests run inside the `node:26-bookworm`
  Docker image, e.g.:
  `docker run --rm -v "$PWD/src/api":/app -w /app node:26-bookworm sh -c "npm ci && npm test"`.
- **The user runs a live stack on host port 9703** (project `audiostreamlogger`). NEVER bind 9703
  or touch their `./audio` or `./data`. All smoke tests use an ALTERNATE port + `-p <project>` and
  tear down with `docker compose down` (NOT `-v`).
- Workflow smoke tests leave **root-owned files under `.worktrees/<name>/data`**; cleaning a
  worktree sometimes needs `docker run --rm -v "$PWD/.worktrees":/wt alpine sh -c "rm -rf /wt/<name>"`
  then `git worktree prune`.
- `.env` is gitignored (untracked); `.env.example` is committed. The running stack needs a real
  `SESSION_SECRET` in `.env` or it falls back to a dev secret with a warning.
- A docs-sync hook (`.kiro/hooks/keep-docs-updated.json`) auto-updates TODO.md/README.md in English
  on each prompt — expect TODO.md to get touched automatically.

## How work has been done (process that worked well)

- Each piece of work runs as a **workflow in its own git worktree/branch**, merged to `main` via
  fast-forward and pushed. The user approved **push-after-merge**.
- The orchestrator (me) does NOT read app source to investigate — it delegates to workflows and
  only makes small doc/config edits inline.
- **Lesson learned:** long reviewed-design loops can hit their iteration cap and ABORT on complex
  work (happened twice). When the design is substantially sound, resume by implementing from the
  saved design with the remaining findings as explicit requirements, skipping the design-review
  loop. Give design loops generous caps.
- Parallel workflows are fine only when they touch **disjoint files** (e.g. Chunk A on api/frontend
  ran parallel to Chunk B strictly confined to `src/recorder/`). Same-file overlap = conflicts.

## What to do next (in priority order — see TODO.md items)

1. **Item 19 — Dependabot PR triage (user asked to pick these up).** 10 PRs open (#3–#12).
   `gh pr list` to see them. CI status (2026-10-23):
   - GREEN, merge after a quick local verify: **#3** nginx base image, **#5** jsdom, **#7**
     github-actions, **#9** argon2. Merge the non-frontend ones (#3,#7,#9) first; #5 is a major but
     CI-green.
   - RED, do NOT merge individually: **#4** vite-plugin-react, **#6** vite (→8), **#8** vitest (→5),
     **#10** react, **#11/#12** vitest groups. These frontend-toolchain bumps are interdependent —
     bundle vite8 + vitest5 + plugin-react + jsdom (+ maybe react) into ONE worktree upgrade, fix
     the config/API changes, get `npm ci && npm run build && vitest` green, then close the
     superseded individual PRs.
   Per-PR: `gh pr checkout <n>` (or fetch the branch), run `npm ci && npm test`/build in
   node:26-bookworm, then `gh pr merge <n> --squash` when green.
2. **Item 20 — API docs decision:** add OpenAPI/Swagger to the Express api (recommended: `zod` +
   `zod-to-openapi` + swagger-ui-express) vs. migrate the api to FastAPI (big rewrite; only for a
   broader Python motive). Needs a user decision before building.
3. Remaining feature items: **14** (stream URL reachability validation — needs a decide: block-on-
   save vs a "Test" button), **17** (stream ordering / default stream / country-grouped view),
   **18** (recordings reconcile worker job: two-way disk↔DB sync, daily schedulable).
4. A future **full frontend UI/UX overhaul** is explicitly deferred (user wants it later, not now).
   Styling has been kept intentionally minimal until then.

## GitHub (user already did these 2026-10-23)

Dependabot and GitHub Actions are ENABLED on the repo. First Actions run + first Dependabot PRs
exist. If CI behaves unexpectedly on a PR, check the Actions tab (the workflow couldn't be executed
from this environment, only its commands were mirrored from locally-proven ones).
