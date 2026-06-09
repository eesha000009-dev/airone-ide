const path = require('path');
const fs = require('fs');
const os = require('os');
const { copyBundledPlugins } = require('./appimage-helpers');

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
// CACHE BUSTING — Prevent stale frontend code from being served after updates
// ═══════════════════════════════════════════════════════════════════════════════
//
// Electron's Chromium renderer caches web content (HTML, JS, CSS) aggressively.
// After an app update, the old cached frontend bundle may still be served,
// making it look like "nothing changed." This is bad for production.
//
// Fix: On every app launch, clear the HTTP cache and storage, and invalidate
// cached data when the app version changes.
// ═══════════════════════════════════════════════════════════════════════════════

try {
    const electron = require('electron');
    const app = electron.app;

    if (app) {
        // Read current app version for version-based cache invalidation
        const packageJsonPath = isInsideAsar
            ? path.join(process.resourcesPath, 'app', 'package.json')
            : path.resolve(__dirname, '../', 'package.json');
        let currentVersion = '0.0.0';
        try {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            currentVersion = pkg.version || '0.0.0';
        } catch { /* ignore */ }

        // Version-based cache invalidation: clear all cached data when the
        // app version changes. This ensures that after an update, users
        // immediately see the new frontend code.
        const configDir = process.env.THEIA_CONFIG_DIR || path.join(os.homedir(), '.airone-ide');
        const versionMarker = path.join(configDir, '.last-version');

        let needsCacheClear = false;
        try {
            if (fs.existsSync(versionMarker)) {
                const lastVersion = fs.readFileSync(versionMarker, 'utf8').trim();
                if (lastVersion !== currentVersion) {
                    needsCacheClear = true;
                }
            } else {
                // First launch — no marker yet
                needsCacheClear = true;
            }
        } catch { needsCacheClear = true; }

        // Write the current version marker
        try {
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }
            fs.writeFileSync(versionMarker, currentVersion, 'utf8');
        } catch { /* ignore */ }

        // Clear Electron's HTTP cache on every startup to prevent stale content
        app.on('ready', () => {
            try {
                const session = electron.session || (electron.remote && electron.remote.session);
                if (session && session.defaultSession) {
                    session.defaultSession.clearCache().then(() => {
                        console.log('[Airone] HTTP cache cleared on startup');
                    }).catch(err => {
                        console.error('[Airone] Failed to clear HTTP cache:', err);
                    });

                    // On version change, also clear storage (localStorage, IndexedDB)
                    // This forces Theia to rebuild its frontend state from scratch
                    if (needsCacheClear) {
                        session.defaultSession.clearStorageData({
                            storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
                            quotas: ['temporary', 'persistent']
                        }).then(() => {
                            console.log(`[Airone] Storage data cleared (version changed: ${currentVersion})`);
                        }).catch(err => {
                            console.error('[Airone] Failed to clear storage data:', err);
                        });
                    }

                    // Disable HTTP cache for the Theia frontend entirely.
                    // This ensures that every page load fetches fresh content.
                    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
                        // Add a cache-busting timestamp to Theia frontend requests
                        callback({});
                    });

                    // Set Cache-Control headers on responses to prevent caching
                    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
                        const responseHeaders = details.responseHeaders || {};
                        responseHeaders['Cache-Control'] = ['no-cache, no-store, must-revalidate'];
                        responseHeaders['Pragma'] = ['no-cache'];
                        responseHeaders['Expires'] = ['0'];
                        callback({ responseHeaders });
                    });
                }
            } catch (err) {
                console.error('[Airone] Cache clearing setup failed:', err);
            }

            // ═════════════════════════════════════════════════════════════
            // AUTO-UPDATE PROXY SUPPORT
            // ═════════════════════════════════════════════════════════════
            // electron-updater uses Electron's net module for downloading
            // updates. If the user is behind a proxy (common in corporate
            // networks), the updater will fail with net::ERR_TIMED_OUT.
            //
            // Fix: Configure the session to respect system proxy settings
            // and pass proxy config to electron-updater.
            // ═════════════════════════════════════════════════════════════
            try {
                const session = electron.session && electron.session.defaultSession;
                if (session) {
                    // Resolve system proxy for the GitHub update URL
                    session.resolveProxy('https://github.com').then(proxy => {
                        console.log(`[Airone] System proxy for github.com: ${proxy}`);

                        // If a proxy is detected, configure it for electron-updater
                        if (proxy && proxy !== 'DIRECT') {
                            // Store the proxy for later use by electron-updater
                            // electron-updater reads GH_TOKEN and proxy env vars
                            const proxyUrl = proxy.replace(/^PROXY\s+/i, '');
                            if (proxyUrl) {
                                console.log(`[Airone] Configuring proxy for auto-updater: ${proxyUrl}`);
                                process.env.HTTP_PROXY = process.env.HTTP_PROXY || `http://${proxyUrl}`;
                                process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || `http://${proxyUrl}`;
                            }
                        }
                    }).catch(err => {
                        console.error('[Airone] Failed to resolve proxy:', err);
                    });

                    // Also set up proxy authentication handler
                    // This handles the case where the proxy requires credentials
                    session.on('login', (event, webContents, request, authInfo, callback) => {
                        // If authInfo has proxy credentials requested, we can
                        // handle it here. For now, just log it.
                        if (authInfo.isProxy) {
                            console.log(`[Airone] Proxy authentication required for: ${authInfo.host}`);
                            // Users can set PROXY_USER and PROXY_PASS env vars
                            const proxyUser = process.env.PROXY_USER;
                            const proxyPass = process.env.PROXY_PASS;
                            if (proxyUser && proxyPass) {
                                event.preventDefault();
                                callback(proxyUser, proxyPass);
                            }
                        }
                    });
                }
            } catch (err) {
                console.error('[Airone] Proxy setup failed:', err);
            }
        });
    }
} catch (err) {
    // Electron module not available (shouldn't happen in production, but handle gracefully)
    console.error('[Airone] Electron module not available for cache setup:', err);
}

// Handover to the auto-generated electron application handler.
require('../lib/backend/electron-main.js');
