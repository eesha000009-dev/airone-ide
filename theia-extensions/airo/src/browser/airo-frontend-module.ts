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
import { WidgetFactory } from '@theia/core/lib/browser';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging';
import { ToolbarContribution } from '@theia/toolbar/lib/browser/toolbar-interfaces';
import { AiroContribution } from './airo-contribution';
import { AiroToolbarContribution } from './airo-toolbar-contribution';
import { AiroLanguageContribution } from './airo-language-contribution';
import { AiroSerialWidget } from './airo-serial-widget';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';
import {
    AiroSketchService,
    AiroSerialService,
    AIRO_SKETCH_PATH,
    AIRO_SERIAL_PATH,
    AiroSketchClient,
    AiroSerialClient
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

    // ─── Commands, Menus, Keybindings ────────────────────────────────────

    bind(AiroContribution).toSelf().inSingletonScope();
    [CommandContribution, MenuContribution, KeybindingContribution].forEach(serviceIdentifier =>
        bind(serviceIdentifier).toService(AiroContribution)
    );

    // ─── Toolbar Contribution ────────────────────────────────────────────

    bind(AiroToolbarContribution).toSelf().inSingletonScope();
    bind(ToolbarContribution).toService(AiroToolbarContribution);

    // ─── .airo Language Support (TextMate grammar) ──────────────────────

    bind(AiroLanguageContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(AiroLanguageContribution);

    // ─── Serial Monitor Widget ───────────────────────────────────────────

    bind(AiroSerialWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AiroSerialWidget.ID,
        createWidget: () => context.container.get<AiroSerialWidget>(AiroSerialWidget),
    })).inSingletonScope();
});
