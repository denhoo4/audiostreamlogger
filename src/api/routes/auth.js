/**
 * Auth routes: login / logout / me / change-password (design §2.4).
 *
 * Mounted under /auth. The session stack (express-session + the SQLite-backed
 * store) is configured in index.js; these handlers only read/write req.session.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const {
    getUserByUsername,
    verifyPassword,
    changePassword,
} = require('../auth/service');

// Minimal new-password policy: reject empty / trivially short passwords.
const MIN_PASSWORD_LENGTH = 4;

// POST /auth/login — verify credentials and open a session.
router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (
        typeof username !== 'string' ||
        username.trim() === '' ||
        typeof password !== 'string' ||
        password === ''
    ) {
        return res.status(400).json({ error: 'username and password required' });
    }

    try {
        const user = getUserByUsername(username);
        // Same response for unknown-user and bad-password (no enumeration).
        if (!user || !(await verifyPassword(user.password_hash, password))) {
            console.log(`auth: failed login for ${username}`);
            return res.status(401).json({ error: 'invalid credentials' });
        }

        // Regenerate the session on login to prevent session fixation.
        return req.session.regenerate((err) => {
            if (err) {
                console.error('auth: session regenerate failed:', err);
                return res.status(500).json({ error: 'internal error' });
            }
            req.session.userId = user.id;
            req.session.username = user.username;
            return res.json({ authenticated: true, username: user.username });
        });
    } catch (err) {
        console.error('auth: login error:', err);
        return res.status(500).json({ error: 'internal error' });
    }
});

// POST /auth/logout — destroy the session; idempotent (always 200).
router.post('/logout', (req, res) => {
    if (!req.session) {
        return res.json({ ok: true });
    }
    return req.session.destroy((err) => {
        if (err) {
            console.error('auth: logout error:', err);
            return res.status(500).json({ error: 'internal error' });
        }
        res.clearCookie('connect.sid');
        return res.json({ ok: true });
    });
});

// GET /auth/me — current auth state; never errors on a missing session.
router.get('/me', (req, res) => {
    if (req.session && req.session.userId) {
        return res.json({ authenticated: true, username: req.session.username });
    }
    return res.json({ authenticated: false });
});

// POST /auth/change-password — requires auth; verify current, then update hash.
router.post('/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return res.status(400).json({ error: 'current and new password required' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: 'new password too short' });
    }

    try {
        const user = getUserByUsername(req.user.username);
        if (!user) {
            // Session referenced a user that no longer exists.
            return res.status(401).json({ error: 'authentication required' });
        }
        if (!(await verifyPassword(user.password_hash, currentPassword))) {
            return res.status(400).json({ error: 'current password incorrect' });
        }

        await changePassword(user.id, newPassword);
        console.log(`auth: password changed for ${user.username}`);
        return res.json({ ok: true });
    } catch (err) {
        console.error('auth: change-password error:', err);
        return res.status(500).json({ error: 'internal error' });
    }
});

module.exports = router;
