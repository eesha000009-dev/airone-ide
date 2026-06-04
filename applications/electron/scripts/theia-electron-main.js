const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, dialog } = require('electron');
const { copyBundledPlugins } = require('./appimage-helpers');

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS — Prevent silent crashes
// Without these, any unhandled exception/rejection crashes the Electron process
// silently (splash screen shows, then disappears).
// ═══════════════════════════════════════════════════════════════════════════════

let fatalErrorOccurred = false;

process.on('uncaughtException', (error) => {
    console.error('[Airone IDE] FATAL: Uncaught Exception:', error);
    fatalErrorOccurred = true;
    try {
        dialog.showErrorBox(
            'Airone IDE — Unexpected Error',
            `An unexpected error occurred:\n\n${error.message || String(error)}\n\nPlease restart the application. ` +
            `If this persists, report at https://github.com/eesha000009-dev/airone-ide/issues`
        );
    } catch {
        // dialog may not be available yet
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Airone IDE] FATAL: Unhandled Promise Rejection:', reason);
    // Don't show dialog for rejections — they're usually less critical
    // but DO log them so we can diagnose issues
});

// Update to override the supported VS Code API version.
// process.env.VSCODE_API_VERSION = '1.50.0'

// Detect if running as AppImage
const isAppImage = !!process.env.APPIMAGE;

// When packaged with asar, __dirname is inside app.asar (e.g., .../app.asar/scripts)
// but plugins are in extraResources at .../app/plugins (outside the asar)
const isInsideAsar = __dirname.includes('.asar');
const bundledPluginsDir = isInsideAsar
    ? path.join(process.resourcesPath, 'app', 'plugins')
    : path.resolve(__dirname, '../', 'plugins');

if (isAppImage) {
    // When running as AppImage, use a user-writable directory for the built-in plugins
    // The AppImage mount point (/tmp/.mount_*) is read-only
    const configDir = process.env.THEIA_CONFIG_DIR || path.join(os.homedir(), '.airone-ide');
    const userPluginsDir = path.join(configDir, 'builtInPlugins');
    const packageJsonPath = path.resolve(__dirname, '../', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version;

    // Copy bundled plugins to user directory if needed (first run or version update)
    const useUserDir = copyBundledPlugins(bundledPluginsDir, userPluginsDir, currentVersion);
    // If copying fails, fall back to the read-only bundled directory (will be improved in follow up of GH-630)
    process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${useUserDir ? userPluginsDir : bundledPluginsDir}`;

} else {
    // Use a set of builtin plugins in our application.
    process.env.THEIA_DEFAULT_PLUGINS = `local-dir:${bundledPluginsDir}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Start Theia backend with error protection
// ═══════════════════════════════════════════════════════════════════════════════
try {
    // Handover to the auto-generated electron application handler.
    require('../lib/backend/electron-main.js');
} catch (error) {
    console.error('[Airone IDE] FATAL: Failed to start Theia backend:', error);
    try {
        dialog.showErrorBox(
            'Airone IDE — Failed to Start',
            `The backend failed to start:\n\n${error.message || String(error)}\n\n` +
            `Try reinstalling Airone IDE. If this persists, report at ` +
            `https://github.com/eesha000009-dev/airone-ide/issues`
        );
    } catch {
        // dialog may not be available
    }
    try {
        app.quit();
    } catch {
        // nothing we can do
    }
}
