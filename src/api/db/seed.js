/**
 * Idempotent admin seeding.
 *
 * seedAdmin(db) inserts a single `admin` user with an Argon2id hash of the
 * password 'admin' the first time it runs. It never inserts a second admin and
 * never overwrites an existing hash, so restarting the api is safe. There is no
 * env override for the seeded credentials (see design §2.1 / FR-2).
 */
const argon2 = require('argon2');

async function seedAdmin(db) {
    const existing = db
        .prepare('SELECT id FROM users WHERE username = ?')
        .get('admin');
    if (existing) {
        return;
    }

    const passwordHash = await argon2.hash('admin', { type: argon2.argon2id });
    db.prepare(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)'
    ).run('admin', passwordHash);
}

module.exports = { seedAdmin };
