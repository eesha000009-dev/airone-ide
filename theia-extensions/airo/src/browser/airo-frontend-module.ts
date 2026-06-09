/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import '../../src/browser/style/airo-sidebar.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { WidgetFactory } from '@theia/core/lib/browser';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging';
import { AiroContribution } from './airo-contribution';
import { AiroToolbarContribution } from './airo-toolbar-contribution';
import { AiroLanguageContribution } from './airo-language-contribution';
// NOTE: NewSketchDialog has been REMOVED. The existing Theia "New File" command
// (core.newFile) is now overridden to create .airo sketches using Theia's
// built-in SingleTextInputDialog. No separate dialog class needed.
import { AiroSerialWidget } from './airo-serial-widget';
import { AiroEspFlashService } from './airo-esp-flash-service';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import {
    AiroSketchService,
    AiroSerialService,
    AiroUploadService,
    AIRO_SKETCH_PATH,
    AIRO_SERIAL_PATH,
    AIRO_UPLOAD_PATH,
    AiroSketchClient,
    AiroSerialClient,
    AiroUploadClient
} from '../common/airo-protocol';

export default new ContainerModule((bind, _unbind, isBound, rebind) => {
    // ─── Backend Service Proxies (RPC) ───────────────────────────────────

    bind(AiroSketchService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
        return connectionProvider.createProxy<AiroSketchClient>(AIRO_SKETCH_PATH);
    }).inSingletonScope();

    bind(AiroSerialService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
        return connectionProvider.createProxy<AiroSerialClient>(AIRO_SERIAL_PATH);
    }).inSingletonScope();

    bind(AiroUploadService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
        return connectionProvider.createProxy<AiroUploadClient>(AIRO_UPLOAD_PATH);
    }).inSingletonScope();

    // ─── Commands, Menus, Keybindings ────────────────────────────────────

    bind(AiroContribution).toSelf().inSingletonScope();
    [CommandContribution, MenuContribution, KeybindingContribution, FrontendApplicationContribution].forEach(serviceIdentifier =>
        bind(serviceIdentifier).toService(AiroContribution)
    );

    // ─── Toolbar Injection ───────────────────────────────────────────────

    bind(AiroToolbarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AiroToolbarContribution);

    // ─── .airo Language Support (TextMate grammar) ──────────────────────

    bind(AiroLanguageContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(AiroLanguageContribution);

    // ─── Serial Monitor Widget (kept for bottom panel) ───────────────────

    bind(AiroSerialWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AiroSerialWidget.ID,
        createWidget: () => context.container.get<AiroSerialWidget>(AiroSerialWidget),
    })).inSingletonScope();

    // ─── ESP32 Flash Service (esptool-js + Web Serial API) ────────────
    // Frontend-only service that uses esptool-js for ESP32 detection
    // and flashing via the Web Serial API. No Python or Arduino CLI needed.

    bind(AiroEspFlashService).toSelf().inSingletonScope();

    // NOTE: AiroSidebarWidget and AiroSidebarContribution are intentionally
    // NOT registered. The sidebar has been removed per the Arduino-IDE
    // paradigm — all controls live in the toolbar below the menu bar.
});
