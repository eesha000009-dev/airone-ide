/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import {
    Command,
    CommandContribution,
    CommandRegistry,
    Emitter,
    MenuContribution,
    MenuModelRegistry,
    MenuPath,
    MessageService,
    Progress
} from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common';
import { TheiaUpdater, TheiaUpdaterClient, UpdaterError, UpdateInfo, UpdateAvailabilityInfo, UpdaterSettings } from '../../common/updater/theia-updater';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { CommonMenus, OpenerService } from '@theia/core/lib/browser';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import URI from '@theia/core/lib/common/uri';
import { URI as VSCodeURI } from 'vscode-uri';

export namespace TheiaUpdaterCommands {

    const category = 'Airone IDE Updater';

    export const CHECK_FOR_UPDATES: Command = {
        id: 'electron-theia:check-for-updates',
        label: 'Check for Updates...',
        category
    };

    export const RESTART_TO_UPDATE: Command = {
        id: 'electron-theia:restart-to-update',
        label: 'Restart to Update',
        category
    };

}

export namespace TheiaUpdaterMenu {
    export const MENU_PATH: MenuPath = [...CommonMenus.FILE_SETTINGS_SUBMENU, '3_settings_submenu_update'];
}

/**
 * Global event bus for update status — allows other contributions (toolbar)
 * to react to update readiness without polling or executing commands.
 */
@injectable()
export class UpdateStatusNotifier {
    protected readonly onUpdateReadyEmitter = new Emitter<UpdateInfo | undefined>();
    readonly onUpdateReady = this.onUpdateReadyEmitter.event;

    protected readonly onCheckingUpdateEmitter = new Emitter<void>();
    readonly onCheckingUpdate = this.onCheckingUpdateEmitter.event;

    notifyUpdateReady(updateInfo?: UpdateInfo): void {
        this.onUpdateReadyEmitter.fire(updateInfo);
    }

    notifyCheckingUpdate(): void {
        this.onCheckingUpdateEmitter.fire();
    }
}

@injectable()
export class TheiaUpdaterClientImpl implements TheiaUpdaterClient {

    protected readonly onReadyToInstallEmitter = new Emitter<void>();
    readonly onReadyToInstall = this.onReadyToInstallEmitter.event;

    protected readonly onUpdateAvailableEmitter = new Emitter<UpdateAvailabilityInfo>();
    readonly onUpdateAvailable = this.onUpdateAvailableEmitter.event;

    protected readonly onErrorEmitter = new Emitter<UpdaterError>();
    readonly onError = this.onErrorEmitter.event;

    protected readonly onCancelEmitter = new Emitter<void>();
    readonly onCancel = this.onCancelEmitter.event;

    notifyReadyToInstall(): void {
        this.onReadyToInstallEmitter.fire();
    }

    updateAvailable(available: boolean, updateInfo?: UpdateInfo): void {
        this.onUpdateAvailableEmitter.fire({ available, updateInfo });
    }

    reportError(error: UpdaterError): void {
        this.onErrorEmitter.fire(error);
    }

    reportCancelled(): void {
        this.onCancelEmitter.fire();
    }

}

// Dynamic menus aren't yet supported by electron: https://github.com/eclipse-theia/theia/issues/446
@injectable()
export class ElectronMenuUpdater {

    @inject(ElectronMainMenuFactory)
    protected readonly factory: ElectronMainMenuFactory;

    public update(): void {
        this.setMenu();
    }

    private setMenu(): void {
        window.electronTheiaCore.setMenu(this.factory.createElectronMenuBar());
    }

}

@injectable()
export class TheiaUpdaterFrontendContribution implements CommandContribution, MenuContribution {

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(ElectronMenuUpdater)
    protected readonly menuUpdater: ElectronMenuUpdater;

    @inject(TheiaUpdater)
    protected readonly updater: TheiaUpdater;

    @inject(TheiaUpdaterClientImpl)
    protected readonly updaterClient: TheiaUpdaterClientImpl;

    @inject(PreferenceService)
    private readonly preferenceService: PreferenceService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(UpdateStatusNotifier)
    protected readonly updateNotifier: UpdateStatusNotifier;

    protected readyToUpdate = false;

    private progress: Progress | undefined;
    private intervalId: NodeJS.Timeout | undefined;
    private currentUpdateInfo: UpdateInfo | undefined;

    @postConstruct()
    protected init(): void {
        this.updaterClient.onUpdateAvailable(({ available, updateInfo }) => {
            if (available) {
                this.currentUpdateInfo = updateInfo;
                // AUTO-UPDATE: When update is available, automatically start downloading
                // The backend has autoDownload=true, so it's already downloading.
                // Just show a progress notification.
                this.showDownloadProgress();
            } else {
                this.handleNoUpdate();
            }
        });

        this.updaterClient.onReadyToInstall(async () => {
            this.readyToUpdate = true;
            this.menuUpdater.update();
            // Notify the toolbar and other components that an update is ready
            this.updateNotifier.notifyUpdateReady(this.currentUpdateInfo);
            // Set a DOM signal so the toolbar (in a different extension) can detect it
            document.body.setAttribute('data-airone-update-ready', 'true');
            if (this.currentUpdateInfo?.version) {
                document.body.setAttribute('data-airone-update-version', this.currentUpdateInfo.version);
            }
            this.handleUpdatesReady();
        });

        this.updaterClient.onError(error => this.handleError(error));
        this.updaterClient.onCancel(() => this.stopProgress());

        this.preferenceService.ready.then(() => {
            this.syncUpdaterSettings();
        });
        this.preferenceService.onPreferenceChanged(e => {
            if (e.preferenceName === 'updates.checkForUpdates' ||
                e.preferenceName === 'updates.checkInterval' ||
                e.preferenceName === 'updates.channel') {
                this.syncUpdaterSettings();
            }
        });
    }

    protected syncUpdaterSettings(): void {
        const settings: UpdaterSettings = {
            checkForUpdates: this.preferenceService.get<boolean>('updates.checkForUpdates', true),
            checkInterval: this.preferenceService.get<number>('updates.checkInterval', 60),
            channel: this.preferenceService.get<'stable' | 'preview' | 'next'>('updates.channel', 'stable')
        };
        this.updater.setUpdaterSettings(settings);
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(TheiaUpdaterCommands.CHECK_FOR_UPDATES, {
            execute: async () => {
                this.updateNotifier.notifyCheckingUpdate();
                this.updater.checkForUpdates();
            },
            isEnabled: () => !this.readyToUpdate,
            isVisible: () => !this.readyToUpdate
        });
        registry.registerCommand(TheiaUpdaterCommands.RESTART_TO_UPDATE, {
            execute: async () => {
                if (this.readyToUpdate) {
                    this.updater.onRestartToUpdateRequested();
                } else {
                    // Check if an update is available but not yet downloaded
                    const checkAnswer = await this.messageService.info(
                        'No update is ready to install yet. Would you like to check for updates now?',
                        'Check for Updates',
                        'Download from GitHub'
                    );
                    if (checkAnswer === 'Check for Updates') {
                        this.updateNotifier.notifyCheckingUpdate();
                        this.updater.checkForUpdates();
                    } else if (checkAnswer === 'Download from GitHub') {
                        window.open('https://github.com/eesha000009-dev/airone-ide/releases', '_blank');
                    }
                }
            },
            isEnabled: () => true,
            isVisible: () => true
        });
    }

    registerMenus(registry: MenuModelRegistry): void {
        registry.registerMenuAction(TheiaUpdaterMenu.MENU_PATH, {
            commandId: TheiaUpdaterCommands.CHECK_FOR_UPDATES.id
        });
        registry.registerMenuAction(TheiaUpdaterMenu.MENU_PATH, {
            commandId: TheiaUpdaterCommands.RESTART_TO_UPDATE.id
        });
    }

    /**
     * Show a progress notification while the update is downloading.
     * Since autoDownload=true in the backend, the download starts automatically.
     */
    protected async showDownloadProgress(): Promise<void> {
        this.stopProgress();
        const versionText = this.currentUpdateInfo
            ? `v${this.currentUpdateInfo.version}`
            : 'a new version';
        this.progress = await this.messageService.showProgress({
            text: `Airone IDE — Downloading update ${versionText}`,
            options: { cancelable: true }
        }, () => this.updater.cancel());
        let dots = 0;
        this.intervalId = setInterval(() => {
            if (this.progress !== undefined) {
                dots = (dots + 1) % 4;
                this.progress.report({ message: 'Downloading' + '.'.repeat(dots) });
            }
        }, 1000);
    }

    protected handleNoUpdate(): void {
        this.messageService.info('Airone IDE is up to date — no updates available.');
    }

    /**
     * When the update has been downloaded and is ready to install,
     * prompt the user to restart the application.
     */
    protected async handleUpdatesReady(): Promise<void> {
        if (this.progress !== undefined) {
            this.progress.report({ work: { done: 1, total: 1 } });
            this.stopProgress();
        }
        const message = this.currentUpdateInfo
            ? `Airone IDE ${this.currentUpdateInfo.version} has been downloaded. Restart now to apply the update?`
            : 'An Airone IDE update has been downloaded. Restart now to apply the update?';
        const answer = await this.messageService.info(message, 'Later', 'Restart Now');
        if (answer === 'Restart Now') {
            this.updater.onRestartToUpdateRequested();
        }
    }

    protected async handleError(error: UpdaterError): Promise<void> {
        this.stopProgress();
        if (error.errorLogPath) {
            const viewLogAction = 'View Error Log';
            const answer = await this.messageService.error(error.message, viewLogAction);
            if (answer === viewLogAction) {
                const uri = new URI(VSCodeURI.file(error.errorLogPath));
                const opener = await this.openerService.getOpener(uri);
                opener.open(uri);
            }
        } else {
            this.messageService.error(error.message);
        }
    }

    private stopProgress(): void {
        if (this.intervalId !== undefined) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        if (this.progress !== undefined) {
            this.progress.cancel();
            this.progress = undefined;
        }
    }
}
