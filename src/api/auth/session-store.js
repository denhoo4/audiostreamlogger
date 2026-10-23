/**
 * A minimal server-side express-session store backed by the SAME node:sqlite
 * DatabaseSync handle the api already owns (db/index.js).
 *
 * WHY HAND-ROLLED (design §2.8 fallback / FEAT-001 directive — OPTION A):
 * FEAT-001's native-build gate (AC-18) forced the api off better-sqlite3 onto
 * Node's built-in node:sqlite, which also dropped better-sqlite3-session-store.
 * The user chose a server-side revocable store (not stateless cookies) so that
 * logout AND change-password invalidate sessions server-side. No maintained
 * express-session store targets node:sqlite under Express 5, so this store is
 * hand-rolled, kept minimal, and unit-tested. It implements the Store contract
 * express-session actually uses: get / set / destroy / touch (+ an optional
 * `clear` for the expiry sweep).
 *
 * Sessions persist into a `sessions(sid, sess, expire)` table in app.db. Writes
 * happen only on login/logout/change-password and the periodic expiry sweep,
 * preserving the NFR-1 single-infrequent-writer premise (resave:false,
 * saveUninitialized:false, rolling:false are LOCKED in index.js).
 */
module.exports = function (session) {
    const Store = session.Store;

    // Default cookie maxAge (7d) used when a session has no explicit expiry.
    const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    class SqliteSessionStore extends Store {
        /**
         * @param {object} options
         * @param {object} options.client   the node:sqlite DatabaseSync handle
         * @param {object} [options.expired] { clear:boolean, intervalMs:number }
         */
        constructor(options = {}) {
            super();
            if (!options.client) {
                throw new Error('SqliteSessionStore requires a `client` DB handle');
            }
            this.db = options.client;

            this.db.exec(`
                CREATE TABLE IF NOT EXISTS sessions (
                  sid    TEXT PRIMARY KEY,
                  sess   TEXT NOT NULL,
                  expire INTEGER NOT NULL
                );
            `);

            const expired = options.expired || {};
            const clearExpired = expired.clear !== false;
            const intervalMs = expired.intervalMs || 15 * 60 * 1000;
            if (clearExpired) {
                this._sweep = setInterval(() => {
                    try {
                        this.clearExpired();
                    } catch (err) {
                        console.error('session-store: expiry sweep failed:', err.message);
                    }
                }, intervalMs);
                // Do not keep the event loop alive just for the sweep.
                if (this._sweep.unref) {
                    this._sweep.unref();
                }
            }
        }

        _expiryFor(sess) {
            const maxAge = sess && sess.cookie && sess.cookie.maxAge;
            const ttl = typeof maxAge === 'number' ? maxAge : DEFAULT_TTL_MS;
            return Date.now() + ttl;
        }

        get(sid, callback) {
            try {
                const row = this.db
                    .prepare('SELECT sess, expire FROM sessions WHERE sid = ?')
                    .get(sid);
                if (!row) {
                    return callback(null, null);
                }
                if (row.expire <= Date.now()) {
                    // Expired: drop it and report "no session".
                    this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
                    return callback(null, null);
                }
                return callback(null, JSON.parse(row.sess));
            } catch (err) {
                return callback(err);
            }
        }

        set(sid, sess, callback) {
            try {
                const expire = this._expiryFor(sess);
                const payload = JSON.stringify(sess);
                this.db
                    .prepare(
                        `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
                         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
                    )
                    .run(sid, payload, expire);
                return callback ? callback(null) : undefined;
            } catch (err) {
                return callback ? callback(err) : undefined;
            }
        }

        destroy(sid, callback) {
            try {
                this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
                return callback ? callback(null) : undefined;
            } catch (err) {
                return callback ? callback(err) : undefined;
            }
        }

        touch(sid, sess, callback) {
            try {
                const expire = this._expiryFor(sess);
                this.db
                    .prepare('UPDATE sessions SET expire = ? WHERE sid = ?')
                    .run(expire, sid);
                return callback ? callback(null) : undefined;
            } catch (err) {
                return callback ? callback(err) : undefined;
            }
        }

        clear(callback) {
            try {
                this.db.exec('DELETE FROM sessions');
                return callback ? callback(null) : undefined;
            } catch (err) {
                return callback ? callback(err) : undefined;
            }
        }

        /** Remove expired rows (invoked by the periodic sweep). */
        clearExpired() {
            this.db.prepare('DELETE FROM sessions WHERE expire <= ?').run(Date.now());
        }
    }

    return SqliteSessionStore;
};
