const express = require('express');
const app = express();
// Internal-only service: nginx reverse-proxies /api and /util to this port.
// It is never published to the host, so there is no host PORT mapping to honor.
const PORT = process.env.APP_PORT || 3000;

/*
 --------- --------- --------- Routes --------- --------- ---------
*/
const apiRouter = require('./routes/api');
const utilRouter = require('./routes/util');

// Served same-origin behind nginx, so no CORS middleware is needed.
app.use('/api', apiRouter);
app.use('/util', utilRouter);


// Start the server
app.listen(PORT, () => {
  console.log(`API service is running on port ${PORT}`);
});
