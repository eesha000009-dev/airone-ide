/********************************************************************************
 * Copyright (C) 2021 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import * as os from 'os';
import * as path from 'path';

import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';

import { injectable } from '@theia/core/shared/inversify';
import { BrowserWindow } from '@theia/core/electron-shared/electron';

@injectable()
export class IconContribution implements ElectronMainApplicationContribution {

    onStart(application: ElectronMainApplication): void {
        // Set white background color for all windows to prevent black flash on startup
        const windowOptions = application.config.electron.windowOptions;
        if (windowOptions) {
            (windowOptions as any).backgroundColor = '#ffffff';
        }

        if (os.platform() === 'linux') {
            if (windowOptions && windowOptions.icon === undefined) {
                // The window image is undefined. If the executable has an image set, this is used as a fallback.
                // Since AppImage does not support this anymore via electron-builder, set an image for the linux platform.
                windowOptions.icon = path.join(__dirname, '../../resources/icons/WindowIcon/512-512.png');
            }
        }

        // Update icon and background for all existing windows (including splash screen)
        const iconPath = path.join(__dirname, '../../resources/icons/WindowIcon/512-512.png');
        for (const window of BrowserWindow.getAllWindows()) {
            if (os.platform() === 'linux') {
                window.setIcon(iconPath);
            }
            // Set white background to prevent black flash
            try {
                window.setBackgroundColor('#ffffff');
            } catch { /* ignore if not supported */ }
        }
    }
}
