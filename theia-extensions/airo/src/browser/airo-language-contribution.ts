/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { LanguageGrammarDefinitionContribution, getEncodedLanguageId } from '@theia/monaco/lib/browser/textmate';
import { TextmateRegistry } from '@theia/monaco/lib/browser/textmate/textmate-registry';
import { GrammarDefinition } from '@theia/monaco/lib/browser/textmate/textmate-registry';

@injectable()
export class AiroLanguageContribution implements LanguageGrammarDefinitionContribution {

    readonly id = 'airo';
    readonly scopeName = 'source.airo';

    registerTextmateLanguage(registry: TextmateRegistry): void {
        // Register the .airo language with Monaco
        const monacoService = (window as any).monaco;
        if (monacoService) {
            monacoService.languages.register({
                id: this.id,
                extensions: ['.airo'],
                aliases: ['Airo', 'airo'],
                firstLine: '^#.*airo'
            });
        }

        // Register the TextMate grammar
        registry.registerTextmateGrammarScope(this.scopeName, {
            async getGrammarDefinition(): Promise<GrammarDefinition> {
                return {
                    format: 'json',
                    content: JSON.stringify({
                        scopeName: 'source.airo',
                        name: 'Airo',
                        patterns: [
                            {
                                name: 'comment.line.number-sign.airo',
                                match: '#(?!(library|variables|endregion)\\b).*$'
                            },
                            {
                                name: 'keyword.section-marker.airo',
                                match: '#(library|variables)#'
                            },
                            {
                                name: 'keyword.control.airo',
                                match: '\\b(if|else|while|for|return|fn|let|mut|struct|impl|use|mod|pub|const|static|enum|match|loop|trait|type|where|async|await)\\b'
                            },
                            {
                                name: 'keyword.robotics.airo',
                                match: '\\b(robot|motor|sensor|servo|pin|serial|wifi|bluetooth|esp32|board|config|deploy|flash|compile|read|write|analog|digital|i2c|spi|uart|pwm|adc|dac|gpio|interrupt|call|defi|read_for|actfor|senddatato|ask|saveto|init)\\b'
                            },
                            {
                                name: 'keyword.declaration.airo',
                                match: '\\b(Pin defi|loop|read_for|actfor)\\b'
                            },
                            {
                                name: 'string.quoted.double.airo',
                                begin: '"',
                                end: '"',
                                patterns: [
                                    {
                                        name: 'constant.character.escape.airo',
                                        match: '\\\\.'
                                    }
                                ]
                            },
                            {
                                name: 'constant.numeric.airo',
                                match: '\\b[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?\\b'
                            },
                            {
                                name: 'constant.numeric.hex.airo',
                                match: '\\b0x[0-9a-fA-F]+\\b'
                            },
                            {
                                name: 'constant.language.airo',
                                match: '\\b(true|false|null|HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|input|output)\\b'
                            },
                            {
                                name: 'entity.name.type.airo',
                                match: '\\b(u8|u16|u32|u64|i8|i16|i32|i64|f32|f64|bool|char|str|String|Vec|Option|Result|Robot|Motor|Sensor|Servo|Pin|Serial|WiFi|Bluetooth)\\b'
                            },
                            {
                                name: 'variable.other.airo',
                                match: '\\b[a-zA-Z_][a-zA-Z0-9_]*\\b'
                            },
                            {
                                name: 'punctuation.terminator.airo',
                                match: '\\.'
                            }
                        ],
                        repository: {}
                    })
                };
            }
        });

        registry.mapLanguageIdToTextmateGrammar(this.id, this.scopeName);
    }
}
