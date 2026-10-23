# Testing strategy

This project keeps its test tooling deliberately small: the three backend
services run Node's built-in test runner (`node --test`), and the frontend runs
`vitest`. No other runner is used. New tests should follow the patterns already
in each service rather than introducing a new framework.

## Unit vs integration

- **Unit tests** cover pure logic with no I/O: validators, transforms, helpers,
  and the backoff/time/filename utilities. They require no database and run in
  microseconds (for example `src/api/test/validate-stream.test.js`,
  `src/api/test/backup.test.js`, `src/worker/test/*`, `src/recorder/*.test.js`).
- **Integration tests** mount a real Express router over a **cold, temporary
  SQLite database** and drive it over HTTP. The temp DB is created per suite,
  the schema is applied, and the handle is injected into the module cache
  **before** the router/services are required, so the services bind to the temp
  DB instead of the production file. This is the pattern established in
  `src/api/test/jobs-routes.test.js` and reused by the new route suites.

## Where tests live

| Service          | Location                          | Runner        |
| ---------------- | --------------------------------- | ------------- |
| api              | `src/api/test/*.test.js`          | `node --test` |
| worker           | `src/worker/test/*.test.js`       | `node --test` |
| recorder         | `src/recorder/*.test.js`          | `node --test` |
| frontend (React) | `src/frontend/src/**/*.test.{ts,tsx}` | `vitest`  |

## API HTTP test approach (why not supertest)

The api route tests spin up an **ephemeral `node:http` server** (`app.listen(0)`
on `127.0.0.1`) and drive it with the global `fetch`. A manual cookie jar (read
the `Set-Cookie` header, echo it on the next request) carries the session cookie
where auth is exercised end to end.

We chose this over `supertest` on purpose: the ephemeral-server + `fetch`
approach was already established in `jobs-routes.test.js`, it needs **no new
dependency**, and it keeps every `npm ci` lockfile untouched. Adding `supertest`
would have bought little over a few lines of `fetch` wiring.

Two flavours of session handling appear in the suites:

- **Real session stack** — `auth-routes.test.js` mounts the actual
  `express-session` middleware over the hand-rolled `SqliteSessionStore`
  (`src/api/auth/session-store.js`), so "login sets a cookie / logout
  invalidates / change-password" is covered against a genuine revocable
  server-side store. `index.js` auto-starts a server and `process.exit(1)`s on a
  DB error, so it is not requireable; the suite rebuilds the same **locked**
  session options (`resave:false`, `saveUninitialized:false`, `rolling:false`).
- **Fake-session toggle** — the route-authorization suites (`streams-routes`,
  `backup-routes`, `analysis-routes`, `jobs-routes`) only need to flip
  authenticated vs anonymous, so they mount a tiny middleware that sets
  `req.session` to `{ userId: 1 }` or `{}` per request.

### What the api integration suites cover

- `auth-routes.test.js` — login sets a cookie, `/auth/me` reports
  authenticated, logout invalidates, wrong password → 401, change-password
  happy path + wrong-current → 400 + unauthenticated → 401.
- `streams-routes.test.js` — stream CRUD behind `requireAuth` (401 when
  anonymous), create → 201, folder/country/url validation → 400 `{field}`,
  duplicate folder → 409, unknown id → 404.
- `settings-routes.test.js` — the **public** `GET /api/settings` (only
  `{country,name,folder,url}`) and `GET /api/settings2` (nested browse tree)
  respond 200 with no session.
- `backup-routes.test.js` — export/import behind `requireAuth`; the export
  carries **only** streams + allowlisted config and never users/sessions; import
  upserts streams by folder and applies only safe config.
- `analysis-routes.test.js` — `/summary` + `/gaps` behind `requireAuth`, the
  validation branches (missing folder, bad date, start > end), and the
  documented success shapes.

## Frontend tests

Vitest runs in a jsdom environment (`src/test/setup.ts` pulls in
`@testing-library/jest-dom`). Component tests either stub the global `fetch`
with a small permissive router (`App.test.tsx`, `SettingsPage.test.tsx`) or mock
the `../api` client module directly (`RecordingsAnalysis.test.tsx`,
`StreamTable.test.tsx`), whichever keeps the test focused.

WaveSurfer is mocked wherever it is on the render path because it cannot decode
audio under jsdom — see the `vi.mock("wavesurfer.js", …)` block in
`App.test.tsx`. For that reason there is **no** direct wavesurfer-control
integration test; the player transport wiring is covered through `App.test.tsx`
(buttons render/enable) and the pure `useWavesurfer` / `player-hours` helper
tests instead.

## How to run

The host has no Node installed; backend tests run inside the `node:26-bookworm`
image that the services already use. The frontend tests run the same way. The
commands below mirror exactly what CI runs.

Backend (per service):

```bash
cd src/api      && npm ci && npm test   # node --test
cd src/worker   && npm ci && npm test
cd src/recorder && npm ci && npm test
```

Frontend:

```bash
cd src/frontend && npm ci && npm run build && npm run test -- --run
```

Inside a container, for example:

```bash
docker run --rm -v "$PWD/src/api":/app -w /app node:26-bookworm \
  bash -lc "npm ci && node --test"
```

(The api image also installs `python3 make g++` to build the `argon2` native
addon during `npm ci`.)

## Coverage

Coverage is **report-only** today — it is surfaced so we can see the baseline,
but there is **no failing threshold yet**. A threshold can be added later once
the baseline is understood.

- Backend: `npm run test:coverage` → `node --test --experimental-test-coverage`.
- Frontend: `npm run test:coverage` → `vitest run --coverage` (v8 provider,
  `text` + `lcov` reporters, configured in `vitest.config.ts`).

CI runs the frontend coverage step non-blocking so the numbers appear in the job
log without gating the build.
