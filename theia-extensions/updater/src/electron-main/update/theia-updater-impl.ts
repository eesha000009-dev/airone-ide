/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { TheiaUpdater, TheiaUpdaterClient, UpdaterSettings } from '../../common/updater/theia-updater';
import { injectable } from '@theia/core/shared/inversify';
import { CancellationToken } from 'builder-util-runtime';

// ─── Airone IDE GitHub Releases ─────────────────────────────────────────────
// Auto-update URLs pointing to the Airone IDE GitHub releases

const GITHUB_OWNER = 'eesha000009-dev';
const GITHUB_REPO = 'airone-ide';

// electron-updater supports GitHub releases natively
const { autoUpdater } = require('electron-updater');

autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

@injectable()
export class TheiaUpdaterImpl implements TheiaUpdater, ElectronMainApplicationContribution {

    protected clients: Array<TheiaUpdaterClient> = [];
    protected settings: UpdaterSettings = {
        checkForUpdates: true,
        checkInterval: 60,
        channel: 'stable'
    };

    private initialCheck: boolean = true;
    private reportOnFirstRegistration: boolean = false;
    private cancellationToken: CancellationToken = new CancellationToken();
    private updateCheckTimer: NodeJS.Timeout | undefined;

    constructor() {
        // AUTO-DOWNLOAD: When an update is available, download it automatically
        // instead of asking the user. The user will only be prompted to restart.
        autoUpdater.autoDownload = true;

        // Configure autoUpdater for GitHub releases
        autoUpdater.setFeedURL({
            provider: 'github',
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO
        });

        autoUpdater.on('update-available', (info: { version: string }) => {
            if (this.initialCheck) {
                this.initialCheck = false;
                if (this.clients.length === 0) {
                    this.reportOnFirstRegistration = true;
                }
            }
            const updateInfo = { version: info.version };
            this.clients.forEach(c => c.updateAvailable(true, updateInfo));
            // autoDownload = true means electron-updater will download automatically
        });

        autoUpdater.on('update-not-available', () => {
            if (this.initialCheck) {
                this.initialCheck = false;
                return;
            }
            this.clients.forEach(c => c.updateAvailable(false));
        });

        autoUpdater.on('update-downloaded', () => {
            this.clients.forEach(c => c.notifyReadyToInstall());
        });

        autoUpdater.on('error', (err: unknown) => {
            if (err instanceof Error && err.message.includes('cancelled')) {
                return;
            }
            const errorLogPath = autoUpdater.logger.transports.file.getFile().path;
            this.clients.forEach(c => c.reportError({ message: 'An error has occurred while attempting to update.', errorLogPath }));
        });

        autoUpdater.on('download-progress', (progressInfo: { percent: number }) => {
            autoUpdater.logger.info(`Download progress: ${progressInfo.percent}%`);
        });
    }

    checkForUpdates(): void {
        autoUpdater.checkForUpdates();
    }

    setUpdaterSettings(settings: UpdaterSettings): void {
        const settingsChanged = this.settings.checkForUpdates !== settings.checkForUpdates ||
            this.settings.checkInterval !== settings.checkInterval ||
            this.settings.channel !== settings.channel;
        this.settings = settings;
        if (settingsChanged) {
            this.scheduleUpdateChecks();
        }
    }

    onRestartToUpdateRequested(): void {
        autoUpdater.quitAndInstall();
    }

    cancel(): void {
        autoUpdater.logger.info('Update cancelled by user');
        this.cancellationToken.cancel();
        this.clients.forEach(c => c.reportCancelled());
    }

    downloadUpdate(): void {
        autoUpdater.logger.info('Downloading update');
        this.cancellationToken = new CancellationToken();
        autoUpdater.downloadUpdate(this.cancellationToken);

        // Record download stat (best effort)
        try {
            const http = require('http');
            fs.mkdtemp(path.join(os.tmpdir(), 'updater-'))
                .then(tmpDir => {
                    const file = fs.createWriteStream(path.join(tmpDir, 'update'));
                    http.get(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`, (response: { pipe: (dest: NodeJS.WritableStream) => void }) => {
                        response.pipe(file);
                        file.on('finish', () => {
                            file.close();
                        });
                    });
                });
        } catch {
            // Ignore stat tracking errors
        }
    }

    onStart(application: ElectronMainApplication): void {
    }

    onStop(application: ElectronMainApplication): void {
        this.stopUpdateCheckTimer();
    }

    private scheduleUpdateChecks(): void {
        this.stopUpdateCheckTimer();

        if (!this.settings.checkForUpdates) {
            return;
        }

        this.checkForUpdates();

        const intervalMs = Math.max(this.settings.checkInterval, 1) * 60 * 1000;

        this.updateCheckTimer = setInterval(() => {
            if (this.settings.checkForUpdates) {
                this.checkForUpdates();
            }
        }, intervalMs);
    }

    private stopUpdateCheckTimer(): void {
        if (this.updateCheckTimer) {
            clearInterval(this.updateCheckTimer);
            this.updateCheckTimer = undefined;
        }
    }

    setClient(client: TheiaUpdaterClient | undefined): void {
        if (client) {
            this.clients.push(client);
            if (this.reportOnFirstRegistration) {
                this.reportOnFirstRegistration = false;
                this.clients.forEach(c => c.updateAvailable(true));
            }
        }
    }

    disconnectClient(client: TheiaUpdaterClient): void {
        const index = this.clients.indexOf(client);
        if (index !== -1) {
            this.clients.splice(index, 1);
        }
    }

    dispose(): void {
        this.stopUpdateCheckTimer();
        this.clients.forEach(this.disconnectClient.bind(this));
    }

}
