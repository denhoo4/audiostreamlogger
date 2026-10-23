# Verification — new React + Vite frontend (branch `frontend-react`)

First iteration (no `review.json` present at start). App implemented from scratch per `plan.md`.

## Environment

The agent environment has **no Node/npm on PATH** (`node`/`npm` → "Command not found,
please ask your administrator"), exactly as the plan warned. Docker **is** available and
usable, so verification was run inside a one-off `node:20-bookworm` container with the new
app directory bind-mounted. **No docker-compose build of the stack was run**; no
`security-update`-owned files were touched.

All commands below were run from `frontend-react/` via:
`docker run --rm -v "$PWD":/app -w /app node:20-bookworm sh -c "<cmd>"`

## Commands and results

1. `node -v && npm -v` → `v20.20.2`, `10.8.2`.
2. `npm install --no-audit --no-fund` → **added 185 packages**, exit 0.
3. `npm run build` (`tsc -b && vite build`) → **success**, exit 0. Output:
   ```
   vite v6.4.5 building for production...
   ✓ 31 modules transformed.
   dist/index.html                   0.39 kB
   dist/assets/index-<hash>.css      0.22 kB
   dist/assets/index-<hash>.js     208.72 kB │ gzip: 64.91 kB
   ✓ built in 1.24s
   ```
   Two TypeScript errors found on the first attempt were fixed before this passing run:
   - `RefObject<HTMLDivElement | null>` not assignable to the DOM ref → typed the ref as
     `useRef<HTMLDivElement>(null)` / `RefObject<HTMLDivElement>`.
   - `test` property rejected on `vite`'s `defineConfig` + dual-Vite type clash from
     vitest's bundled Vite → moved the test config to a separate `vitest.config.ts`
     (kept out of the production `tsc -b` path); `vite.config.ts` uses `vite`'s
     `defineConfig` only.
4. `npm run test -- --run` (Vitest) → **1 test passed**, exit 0:
   ```
   ✓ src/App.test.tsx (1 test)
   Test Files  1 passed (1)
        Tests  1 passed (1)
   ```
   The test stubs `fetch` so `/api/settings` → `[]` and `/api/settings2` → `{}`, stubs the
   `wavesurfer.js` and regions modules so no real audio decoding happens in jsdom, asserts
   every control renders with the correct id/label (time-total shows "0:00 / 0:00", the
   seven transport buttons, the five selection buttons with Play/Download Selection
   disabled, selector, datetime input, Inladen!, hidden downloadWait), and asserts
   `console.error` was NOT called during render/data load.

## Build output confirmed

`frontend-react/dist/index.html` + `frontend-react/dist/assets/index-<hash>.js` and
`index-<hash>.css` exist after the build.

## Legacy / ownership check

`git -C <worktree> status --porcelain` shows only new paths: `.agents/` and
`frontend-react/`. No changes under `frontend/web/`, `frontend/index.js`,
`frontend/routes/`, `frontend/package.json`, or any Docker/nginx file. `node_modules/`,
`dist/`, and `*.tsbuildinfo` are gitignored by `frontend-react/.gitignore` and are not
staged.

## Not done (out of scope, as instructed)

- No backend changes. No docker-compose stack build. No wiring of the new `dist/` into
  Express/Docker (that touches `security-update`-owned files and is a follow-up).
