const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
// docker-compose maps the host ${PORT} (e.g. 9703) to container port 80, so the
// in-container listen port must stay 80 by default. Use APP_PORT only to override
// the port inside the container; do NOT consume the host-facing PORT env here.
const PORT = process.env.APP_PORT || 80;

/*
 --------- --------- --------- Settings --------- --------- ---------
*/
const apiRouter = require('./routes/api');
const utilRouter = require('./routes/util');
// The frontend is served same-origin (the client calls its own origin /api), so
// cross-origin access is disabled by default. Only enable CORS for an explicit
// allowlist provided via CORS_ORIGIN (comma-separated); otherwise add no CORS middleware.
if (process.env.CORS_ORIGIN) {
  const allowedOrigins = process.env.CORS_ORIGIN.split(',').map((s) => s.trim());
  app.use(cors({ origin: allowedOrigins }));
}

/*
 --------- --------- --------- Routes --------- --------- ---------
*/
app.use(express.static(path.join(__dirname, 'web')));
app.use('/audio', express.static(path.join(__dirname, 'audio')));
app.use('/api', apiRouter);
app.use('/util', utilRouter);
app.use('/logger', utilRouter);


// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});