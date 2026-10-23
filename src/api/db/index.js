/**
 * Opens the single SQLite database file owned by the api service and exports
 * the live handle.
 *
 * The DB lives on the bind-mounted ./data directory (host) -> /usr/src/app/data
 * (container). The api is the only writer; the three workers open the same file
 * read-only.
 *
 * Journal mode is DELETE (rollback journal), NOT WAL: a read-only worker on a
 * `:ro` bind mount can open a rollback-journal DB with no `-shm`/`-wal` write
 * requirement, whereas WAL would require each reader to write-lock a shared
 * -shm file and fail on a read-only mount (see design §2.3).
 *
 * FALLBACK TAKEN (design §2.8 / A-1): the api uses Node's built-in `node:sqlite`
 * (`DatabaseSync`) instead of `better-sqlite3`. `better-sqlite3@^11.3.0` does
 * NOT compile on node:26-bookworm — its native addon calls V8 APIs removed in
 * Node 26's V8 (`v8::Object::GetPrototype`, `v8::Context::GetIsolate`,
 * `PropertyCallbackInfo::This`), so the AC-18 native-build gate fails. `node:sqlite`
 * needs no native build and offers the same `prepare().get()/.run()` + `exec()`
 * surface used by schema/seed/services. Pragmas are issued via `exec()` because
 * `DatabaseSync` has no `.pragma()` helper. `argon2` still compiles cleanly and
 * is unchanged.
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join('/usr/src/app/data', 'app.db');

const db = new DatabaseSync(DB_PATH);

// Rollback journal (default) so read-only workers attach cleanly on a :ro mount.
db.exec('PRAGMA journal_mode = DELETE');
// Ride out the brief write lock the single infrequent writer holds.
db.exec('PRAGMA busy_timeout = 5000');
// Enforce foreign keys for future related tables (e.g. recordings).
db.exec('PRAGMA foreign_keys = ON');

module.exports = db;
