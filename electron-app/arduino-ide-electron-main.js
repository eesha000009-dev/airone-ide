// @ts-check
'use strict';

const os = require('os');
const path = require('path');
const config = require('./package.json').theia.frontend.config;
// `buildDate` is only available in the bundled application.
if (config.buildDate) {
  // `plugins` folder inside Airone IDE. Shipped with VS Code extensions.
  process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${path.resolve(
    __dirname,
    'plugins'
  )}`;
  // `plugins` folder inside the `~/.aironeIDE` folder. For manually installed VS Code extensions.
  process.env.THEIA_PLUGINS = [
    process.env.THEIA_PLUGINS,
    `local-dir:${path.resolve(os.homedir(), '.aironeIDE', 'plugins')}`,
  ]
    .filter(Boolean)
    .join(',');
}

// Guard: only load the main Electron module if running inside Electron.
// When loaded by electron-builder during packaging (plain Node.js context),
// `process.versions.electron` is undefined. Inside Electron it's set (e.g. "30.1.2").
// This prevents the crash: "Cannot read properties of undefined (reading 'requestSingleInstanceLock')"
if (process.versions.electron) {
  require('./lib/backend/electron-main');
}
