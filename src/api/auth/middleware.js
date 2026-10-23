/**
 * requireAuth — standalone auth gate applied per-route (NOT globally), so it can
 * later wrap selected main-screen endpoints without touching the public player
 * routes (design §2.4 "requireAuth design").
 *
 * Checks req.session?.userId; if absent responds 401 {error:'authentication
 * required'}. Otherwise it attaches req.user = {id, username} (from the session)
 * and calls next(). No role logic yet, but the users row is available for adding
 * roles later without changing this signature.
 */
function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'authentication required' });
    }
    req.user = { id: req.session.userId, username: req.session.username };
    return next();
}

module.exports = { requireAuth };
