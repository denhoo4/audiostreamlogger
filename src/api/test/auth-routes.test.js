/**
 * Integration coverage for the /auth router driving the REAL session stack
 * (design §2.4, FR-2). Unlike the fake-session toggle used elsewhere, this suite
 * mounts the actual express-session middleware over the hand-rolled
 * SqliteSessionStore (auth/session-store.js) bound to a cold temp SQLite DB via
 * the require.cache injection pattern FEAT-001 established, then exercises the
 * real routes/auth.js end to end with a manual set-cookie jar over fetch.
 *
 * index.js auto-starts the server + scheduler and process.exit(1) on a DB
 * failure, so it is NOT requireable; this test rebuilds the minimal session app
 * the routes need (the same session options index.js locks: resave:false,
 * saveUninitialized:false, rolling:false) so login/logout/change-password are
 * covered against a genuine server-side store.
 *
 * Covers: login sets a cookie; GET /auth/me is authenticated after login;
 * logout invalidates (subsequent /auth/me anonymous); wrong password -> 401;
 * change-password happy path + wrong current -> 400 + unauthenticated -> 401.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');

const { applySchema } = require('../db/schema');
const { seedAdmin } = require('../db/seed');

let tmpDir;
let db;
let server;
let baseUrl;

before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asl-authroutes-'));
    const dbPath = path.join(tmpDir, 'app.db');
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');

    const dbModulePath = require.resolve('../db');
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: db,
    };

    applySchema(db);
    await seedAdmin(db); // admin / admin

    // Require AFTER the db cache injection so auth/service.js binds the temp DB.
    const authRouter = require('../routes/auth');
    const SqliteStore = require('../auth/session-store')(session);

    const app = express();
    // Mirror the LOCKED session options from index.js over the real store.
    app.use(
        session({
            store: new SqliteStore({
                client: db,
                // No periodic sweep in tests; clearExpired is covered elsewhere.
                expired: { clear: false },
            }),
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            rolling: false,
            cookie: {
                httpOnly: true,
                sameSite: 'lax',
                secure: false,
                maxAge: 7 * 24 * 60 * 60 * 1000,
            },
        })
    );
    app.use(express.json({ limit: '100kb' }));
    app.use('/auth', authRouter);

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    try {
        db.close();
    } catch {
        /* already closed */
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Minimal cookie jar: carry the Set-Cookie value (just the name=value pair) from
 * one response onto the next request's Cookie header, so the real session cookie
 * round-trips exactly as a browser would do same-origin.
 */
function makeJar() {
    let cookie = null;
    return {
        get cookie() {
            return cookie;
        },
        capture(res) {
            const set = res.headers.get('set-cookie');
            if (set) {
                cookie = set.split(';')[0];
            }
        },
        clear() {
            cookie = null;
        },
    };
}

async function reqJson(jar, method, pathname, body) {
    const opts = { method, headers: {} };
    if (jar && jar.cookie) {
        opts.headers.Cookie = jar.cookie;
    }
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${pathname}`, opts);
    if (jar) {
        jar.capture(res);
    }
    return { status: res.status, body: await res.json().catch(() => undefined) };
}

test('login sets a session cookie and reports authenticated', async () => {
    const jar = makeJar();
    const login = await reqJson(jar, 'POST', '/auth/login', {
        username: 'admin',
        password: 'admin',
    });
    assert.strictEqual(login.status, 200);
    assert.strictEqual(login.body.authenticated, true);
    assert.strictEqual(login.body.username, 'admin');
    assert.ok(jar.cookie, 'login set a session cookie');
    assert.match(jar.cookie, /connect\.sid=/);

    // A session row was persisted server-side (revocable store).
    const n = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    assert.ok(n >= 1, 'a session row was persisted');
});

test('GET /auth/me reports authenticated after login', async () => {
    const jar = makeJar();
    await reqJson(jar, 'POST', '/auth/login', { username: 'admin', password: 'admin' });
    const me = await reqJson(jar, 'GET', '/auth/me');
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.authenticated, true);
    assert.strictEqual(me.body.username, 'admin');
});

test('logout invalidates the session (subsequent /auth/me is anonymous)', async () => {
    const jar = makeJar();
    await reqJson(jar, 'POST', '/auth/login', { username: 'admin', password: 'admin' });

    const out = await reqJson(jar, 'POST', '/auth/logout');
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.ok, true);

    // Re-use whatever cookie survived logout: the server destroyed it, so /auth/me
    // must now read anonymous.
    const me = await reqJson(jar, 'GET', '/auth/me');
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.authenticated, false);
});

test('login with a wrong password returns 401 and sets no auth', async () => {
    const jar = makeJar();
    const res = await reqJson(jar, 'POST', '/auth/login', {
        username: 'admin',
        password: 'wrong',
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'invalid credentials');

    const me = await reqJson(jar, 'GET', '/auth/me');
    assert.strictEqual(me.body.authenticated, false);
});

test('login rejects a missing username/password with 400', async () => {
    const res = await reqJson(null, 'POST', '/auth/login', { username: 'admin' });
    assert.strictEqual(res.status, 400);
});

test('change-password requires auth (401 when anonymous)', async () => {
    const res = await reqJson(null, 'POST', '/auth/change-password', {
        currentPassword: 'admin',
        newPassword: 'admin2',
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'authentication required');
});

test('change-password rejects a wrong current password with 400', async () => {
    const jar = makeJar();
    await reqJson(jar, 'POST', '/auth/login', { username: 'admin', password: 'admin' });
    const res = await reqJson(jar, 'POST', '/auth/change-password', {
        currentPassword: 'not-the-password',
        newPassword: 'whatever',
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'current password incorrect');
});

test('change-password happy path: new password works, old one 401s', async () => {
    const jar = makeJar();
    await reqJson(jar, 'POST', '/auth/login', { username: 'admin', password: 'admin' });

    const changed = await reqJson(jar, 'POST', '/auth/change-password', {
        currentPassword: 'admin',
        newPassword: 'admin-new',
    });
    assert.strictEqual(changed.status, 200);
    assert.strictEqual(changed.body.ok, true);

    // The new password now logs in.
    const jar2 = makeJar();
    const good = await reqJson(jar2, 'POST', '/auth/login', {
        username: 'admin',
        password: 'admin-new',
    });
    assert.strictEqual(good.status, 200);
    assert.strictEqual(good.body.authenticated, true);

    // The old password no longer works.
    const jar3 = makeJar();
    const bad = await reqJson(jar3, 'POST', '/auth/login', {
        username: 'admin',
        password: 'admin',
    });
    assert.strictEqual(bad.status, 401);

    // Restore the seeded password so suite ordering stays independent.
    await reqJson(jar2, 'POST', '/auth/change-password', {
        currentPassword: 'admin-new',
        newPassword: 'admin',
    });
});
