/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { ToolbarContribution, ToolbarRegistry } from '@theia/toolbar/lib/browser/toolbar-contribution';
import {
    AIRO_COMPILE_COMMAND,
    AIRO_VERIFY_COMMAND,
    AIRO_UPLOAD_COMMAND,
    AIRO_SERIAL_MONITOR_COMMAND
} from './airo-contribution';

/**
 * Toolbar contribution that adds Compile, Verify, Upload, and Serial Monitor
 * buttons to the Theia toolbar (the strip below the menu bar).
 */
@injectable()
export class AiroToolbarContribution implements ToolbarContribution {

    registerToolbarItems(registry: ToolbarRegistry): void {
        // Compile button
        registry.registerItem({
            id: 'airo.compile.toolbar',
            command: AIRO_COMPILE_COMMAND.id,
            tooltip: 'Compile (Ctrl+Shift+R)',
            priority: -100,
            group: 'navigation'
        });

        // Verify button
        registry.registerItem({
            id: 'airo.verify.toolbar',
            command: AIRO_VERIFY_COMMAND.id,
            tooltip: 'Verify (Ctrl+R)',
            priority: -90,
            group: 'navigation'
        });

        // Upload button
        registry.registerItem({
            id: 'airo.upload.toolbar',
            command: AIRO_UPLOAD_COMMAND.id,
            tooltip: 'Upload (Ctrl+U)',
            priority: -80,
            group: 'navigation'
        });

        // Serial Monitor button
        registry.registerItem({
            id: 'airo.serial.toolbar',
            command: AIRO_SERIAL_MONITOR_COMMAND.id,
            tooltip: 'Serial Monitor (Ctrl+Shift+M)',
            priority: -70,
            group: 'navigation'
        });
    }
}
