/**
 * Docs mount: serves the Swagger UI and the raw OpenAPI spec, BOTH behind the
 * real requireAuth middleware (the api is admin-only — the docs must not be
 * publicly reachable). Effective paths once mounted in index.js:
 *   GET /api/docs       → Swagger UI (HTML + bundled assets)
 *   GET /api/docs.json  → the raw OpenAPI 3.0 document
 *
 * The UI is configured to load the spec from /api/docs.json so its "Try it out"
 * calls hit the same-origin authed path. Assets served by swagger-ui-express
 * sit under the mount path (/api/docs/*), which already falls under nginx's
 * `location /api/` proxy — no nginx change needed.
 */
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { requireAuth } = require('../auth/middleware');
const { buildOpenApiDocument } = require('./spec');

/**
 * Register the docs routes on the given Express app.
 * @param {import('express').Express} app
 */
function mountDocs(app) {
    // Build once at mount time — the document is static for the process.
    const document = buildOpenApiDocument();

    const router = express.Router();

    // Raw spec (authed). Placed first so /api/docs.json is not shadowed by the
    // UI's static asset handling.
    router.get('/docs.json', requireAuth, (req, res) => {
        res.json(document);
    });

    // Swagger UI (authed). requireAuth gates every /api/docs* request, then the
    // swagger-ui-express serve+setup middleware renders the UI / assets.
    router.use(
        '/docs',
        requireAuth,
        swaggerUi.serve,
        swaggerUi.setup(document, {
            swaggerOptions: { url: '/api/docs.json' },
        })
    );

    app.use('/api', router);
}

module.exports = { mountDocs };
