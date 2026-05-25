// @ts-check
'use strict';

// `true` if the this (backend main) process has been forked.
if (process.send) {
  const util = require('util');
  for (const name of ['log', 'trace', 'debug', 'info', 'warn', 'error']) {
    console[name] = function () {
      // eslint-disable-next-line prefer-rest-params
      const args = Object.values(arguments);
      const message = util.format(...args);
      process.send?.({ severity: name, message }); // send the log message to the parent process (electron main)
    };
  }
}

// Load the Theia-generated backend main with error handling
try {
  require('./src-gen/backend/main');
} catch (err) {
  console.error('[Airone IDE Backend] FATAL: Failed to load the backend main module:', err);
  // If we have IPC, send the error to the parent process
  if (process.send) {
    process.send({ severity: 'error', message: `FATAL: Backend failed to start: ${err.message || err}` });
  }
  process.exit(1);
}
