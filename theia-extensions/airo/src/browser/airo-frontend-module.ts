/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { WidgetFactory } from '@theia/core/lib/browser';
import { AiroContribution } from './airo-contribution';
import { AiroLanguageContribution } from './airo-language-contribution';
import { AiroSerialWidget } from './airo-serial-widget';
import { LanguageGrammarDefinitionContribution } from '@theia/monaco/lib/browser/textmate';

export default new ContainerModule(bind => {
    // Commands, menus, and keybindings
    bind(AiroContribution).toSelf().inSingletonScope();
    [CommandContribution, MenuContribution, KeybindingContribution].forEach(serviceIdentifier =>
        bind(serviceIdentifier).toService(AiroContribution)
    );

    // .airo language support - TextMate grammar
    bind(AiroLanguageContribution).toSelf().inSingletonScope();
    bind(LanguageGrammarDefinitionContribution).toService(AiroLanguageContribution);

    // Serial Monitor Widget
    bind(AiroSerialWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AiroSerialWidget.ID,
        createWidget: () => context.container.get<AiroSerialWidget>(AiroSerialWidget),
    })).inSingletonScope();
});
