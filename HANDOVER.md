# Handover — audiostreamlogger

A briefing for the next developer (human or assistant) picking this up in a fresh
session. This file is about *how we work* — the user's preferences, the process,
and the environment gotchas. The factual history lives in
[HISTORY.md](HISTORY.md); the open and future work lives in [TODO.md](TODO.md); the
system design lives in [ARCHITECTURE.md](ARCHITECTURE.md).

## Current state

The modernization roadmap is complete and merged to `origin/main`. Working tree
clean, no open worktrees/branches of ours left dangling (bar the
`frontend-toolchain-upgrade` branch awaiting its merge step). For what is still
open, defer to [TODO.md](TODO.md) — don't track it here.

## Language

- The user converses in **Dutch**. Speak Dutch with the user.
- Everything committed to the repo stays in **English** — docs, code, comments,
  and commit messages. So: Dutch in chat, English in the repo. Keep that split
  clean.

## Process

- Each piece of work runs as a **workflow in its own git worktree/branch**, with a
  **semantic review gate**, then a **fast-forward merge to main + push**.
  Push-after-merge is pre-approved — you don't need to ask again.
- **Heavy, destructive, or race-sensitive features get a DESIGN phase first.** This
  has caught real safety bugs, not hypothetical ones:
  - A blind SQL `REPLACE` in the folder-rename would have corrupted the date stamp
    for numeric folder names (`100nl`, `z100`, `m2o`). The design caught it; the fix
    is stamp-anchored path rebuilding.
  - A tautological "is it recording right now" guard would have blocked *all*
    deletes. The design caught it; the fix is a concrete current-slot predicate.
- When a reviewed-design loop hits its iteration cap, don't abandon the work:
  resume by implementing from the soundest saved design, carrying the remaining
  review findings forward as explicit requirements.
- The user likes being offered **a few options plus a recommendation** before a big
  call, then trusts the assistant to run autonomously through the resulting task
  list.

## Environment

- **The host has no Node.** All node/npm/build/test runs happen inside the
  `node:26-bookworm` image and the service images (which carry ffmpeg and
  audiowaveform). Example:

  ```sh
  docker run --rm -v "$PWD/src/api":/app -w /app node:26-bookworm sh -c "npm ci && npm test"
  ```

- **A live production stack runs on host port 9703.** Never bind 9703, and never
  touch repo-root `./audio` or `./data`. Smoke tests use a throwaway temp dir, an
  alternate port, and `-p <project>`, and tear down with `docker compose down`
  (no `-v`).
- `.env` is gitignored; `.env.example` is the committed template. The running stack
  needs a real `SESSION_SECRET` or it falls back to a dev secret with a warning.

## Docker gotchas

- The **recorder and worker images COPY source files individually**, so *any* new
  `src/recorder` or `src/worker` module needs a matching `COPY` line in its
  Dockerfile. Verify with a real `docker build`, not just `node --test` — a missing
  `COPY folder-utils.js` once crashed the recorder at boot in production.
- After a frontend or api change, **rebuild the whole stack**
  (`docker compose up -d --build`), not a single service. A stale image once
  rendered an "undefined" Stream Health panel.

## Notifications

The user is kept in the loop via a **Telegram bot** (token + chat id live in `.env`,
never committed). Convention: send a short message at **workflow START and
COMPLETION only** — not a running commentary. Read the user's Telegram replies at
the start of each turn.

## Docs hook

`.kiro/hooks/keep-docs-updated.json` keeps `TODO.md` / `README.md` current (in
English) on each prompt — expect `TODO.md` to get touched automatically. Don't be
surprised by an auto-edit there.

## GitHub & git

- `gh` is authenticated as **`denhoo4`**.
- Its GraphQL endpoint has intermittently returned 401 while REST kept working —
  **prefer REST for PR operations when GraphQL fails**.
- **Never force-push. Never modify git config.**

## Tone & relationship

Direct and concise, in Dutch with the user. Offer a few options and a recommendation
before big decisions, then run autonomously through the task list and report via
Telegram. The user trusts the assistant to keep the repo in English and the
conversation in Dutch.

## What's next

See [TODO.md](TODO.md). In short: the bundled frontend-toolchain upgrade is awaiting
its merge step, the cursor-anchored wavesurfer zoom is in progress, and a full
frontend UI/UX overhaul is deferred for later.
