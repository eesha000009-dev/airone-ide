/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import '../browser/style/airo-sidebar.css';

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { WidgetFactory } from '@theia/core/lib/browser';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging';
import { AiroContribution } from './airo-contribution';
import { AiroLanguageContribution } from './airo-language-contribution';
import { AiroSerialWidget } from './airo-serial-widget';
import { AiroSidebarWidget } from './airo-sidebar-widget';
import { AiroSidebarContribution } from './airo-sidebar-contribution';
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

    // AiroSketchService — frontend proxy to backend
    bind(AiroSketchService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
        return connectionProvider.createProxy<AiroSketchClient>(AIRO_SKETCH_PATH);
    }).inSingletonScope();

    // AiroSerialService — frontend proxy to backend
    bind(AiroSerialService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get<WebSocketConnectionProvider>(WebSocketConnectionProvider);
        return connectionProvider.createProxy<AiroSerialClient>(AIRO_SERIAL_PATH);
    }).inSingletonScope();

    // ─── Commands, Menus, Keybindings ────────────────────────────────────

    bind(AiroContribution).toSelf().inSingletonScope();
    [CommandContribution, MenuContribution, KeybindingContribution].forEach(serviceIdentifier =>
        bind(serviceIdentifier).toService(AiroContribution)
    );

    // ─── .airo Language Support (TextMate grammar) ──────────────────────

    bind(AiroLanguageContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(AiroLanguageContribution);

    // ─── Serial Monitor Widget ───────────────────────────────────────────

    bind(AiroSerialWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AiroSerialWidget.ID,
        createWidget: () => context.container.get<AiroSerialWidget>(AiroSerialWidget),
    })).inSingletonScope();

    // ─── Airone Sidebar Panel ────────────────────────────────────────────

    // Register the sidebar widget
    bind(AiroSidebarWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AiroSidebarWidget.ID,
        createWidget: () => context.container.get<AiroSidebarWidget>(AiroSidebarWidget),
    })).inSingletonScope();

    // Register the sidebar contribution (adds icon to activity bar)
    bind(AiroSidebarContribution).toSelf().inSingletonScope();
    [FrontendApplicationContribution, CommandContribution, KeybindingContribution].forEach(serviceIdentifier =>
        bind(serviceIdentifier).toService(AiroSidebarContribution)
    );
});
