/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'fs';
import * as path from 'path';
import { VerifyResult, SyntaxError } from '../common/airo-protocol';

/**
 * Built-in TypeScript-based .airo syntax checker.
 *
 * This provides immediate feedback without requiring Python or the
 * airo_compiler module to be installed. It performs structural and
 * syntactic validation of .airo files.
 *
 * For full compilation (transpilation to C++ and ESP32 flashing),
 * the Python-based airo_compiler is used as a secondary step when available.
 */
@injectable()
export class AiroBuiltInCompiler {

    /**
     * Verify the syntax and structure of a .airo file.
     * This does NOT require Python — it runs entirely in the Node.js process.
     */
    async verify(filePath: string): Promise<VerifyResult> {
        const errors: SyntaxError[] = [];
        let content: string;
        const fileName: string = path.basename(filePath.startsWith('file://') ? this.fsPathFromUri(filePath) : filePath);

        // Read the file
        const fsPath = filePath.startsWith('file://') ? this.fsPathFromUri(filePath) : filePath;

        if (!fs.existsSync(fsPath)) {
            return {
                success: false,
                output: '',
                error: `File not found: ${fsPath}`,
                errors: [{ line: 0, column: 0, message: `File not found: ${fsPath}`, severity: 'error' }]
            };
        }

        try {
            content = fs.readFileSync(fsPath, { encoding: 'utf8' });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                output: '',
                error: `Cannot read file: ${message}`,
                errors: [{ line: 0, column: 0, message: `Cannot read file: ${message}`, severity: 'error' }]
            };
        }

        const lines = content.split('\n');

        // ─── 1. Check file extension ──────────────────────────────────────
        if (!fileName.endsWith('.airo')) {
            errors.push({
                line: 0, column: 0,
                message: `File "${fileName}" does not have .airo extension`,
                severity: 'warning'
            });
        }

        // ─── 2. Check for required "Pin defi" section ─────────────────────
        const pinDefiLine = this.findLineWith(lines, 'Pin defi');
        if (pinDefiLine === -1) {
            errors.push({
                line: 0, column: 0,
                message: 'Missing "Pin defi" section — every .airo file must define pins',
                severity: 'error'
            });
        } else {
            // Check that Pin defi has opening brace
            const pinDefiContent = lines.slice(pinDefiLine).join('\n');
            if (!pinDefiContent.includes('{')) {
                errors.push({
                    line: pinDefiLine + 1, column: lines[pinDefiLine].indexOf('Pin defi'),
                    message: '"Pin defi" section is missing opening brace {',
                    severity: 'error'
                });
            }

            // Check pin definitions have proper format: name = number; mode.
            const pinSection = this.extractBlock(lines, pinDefiLine);
            for (let i = 0; i < pinSection.length; i++) {
                const pinLine = pinSection[i].trim();
                if (!pinLine || pinLine.startsWith('#') || pinLine === '{' || pinLine === '}') {
                    continue;
                }
                // Pin definition: name = value; mode.
                const pinMatch = pinLine.match(/^(\w+)\s*=\s*(\d+)\s*;\s*(input|output|INPUT|OUTPUT|INPUT_PULLUP)\s*\.\s*$/);
                if (!pinMatch && pinLine !== '{' && pinLine !== '}') {
                    // It might be a comment or valid syntax, don't be too strict
                    // Only warn if it looks like it should be a pin def
                    if (pinLine.includes('=') && !pinLine.includes('==') && !pinLine.startsWith('#')) {
                        if (!pinLine.endsWith('.')) {
                            errors.push({
                                line: pinDefiLine + i + 1, column: 0,
                                message: `Pin definition should end with "." — got: ${pinLine}`,
                                severity: 'warning'
                            });
                        }
                    }
                }
            }
        }

        // ─── 3. Check for required "loop" section ─────────────────────────
        const loopLine = this.findLineWith(lines, 'loop');
        if (loopLine === -1) {
            errors.push({
                line: 0, column: 0,
                message: 'Missing "loop" section — every .airo file must have a main loop',
                severity: 'error'
            });
        } else {
            // Check that loop has opening brace
            const loopContent = lines.slice(loopLine).join('\n');
            if (!loopContent.includes('{')) {
                errors.push({
                    line: loopLine + 1, column: lines[loopLine].indexOf('loop'),
                    message: '"loop" section is missing opening brace {',
                    severity: 'error'
                });
            }
        }

        // ─── 4. Check for #library# section ───────────────────────────────
        const libraryLine = this.findLineWith(lines, '#library#');
        if (libraryLine === -1) {
            errors.push({
                line: 0, column: 0,
                message: 'Missing "#library#" section — add "#library#" at the top to import body modules',
                severity: 'warning'
            });
        }

        // ─── 5. Check for #variables# section ─────────────────────────────
        const variablesLine = this.findLineWith(lines, '#variables#');
        if (variablesLine === -1) {
            errors.push({
                line: 0, column: 0,
                message: 'Missing "#variables#" section — add "#variables#" to declare variables',
                severity: 'warning'
            });
        }

        // ─── 6. Check brace matching ──────────────────────────────────────
        const braceErrors = this.checkBraces(lines);
        errors.push(...braceErrors);

        // ─── 7. Check statement terminators (.) ───────────────────────────
        const terminatorErrors = this.checkTerminators(lines);
        errors.push(...terminatorErrors);

        // ─── 8. Check read_for syntax ─────────────────────────────────────
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.includes('read_for') && !line.startsWith('#')) {
                const match = line.match(/read_for\((\d+)\)/);
                if (!match) {
                    errors.push({
                        line: i + 1, column: lines[i].indexOf('read_for'),
                        message: 'read_for expects a number in parentheses, e.g. read_for(1000)',
                        severity: 'error'
                    });
                }
            }
        }

        // ─── 9. Check actfor syntax ───────────────────────────────────────
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.includes('actfor') && !line.startsWith('#')) {
                const match = line.match(/actfor\((\d+)\)/);
                if (!match) {
                    errors.push({
                        line: i + 1, column: lines[i].indexOf('actfor'),
                        message: 'actfor expects a number in parentheses, e.g. actfor(1000)',
                        severity: 'error'
                    });
                }
            }
        }

        // ─── 10. Check senddatato syntax ──────────────────────────────────
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.includes('senddatato') && !line.startsWith('#')) {
                const match = line.match(/senddatato\((.+)\)\s*\./);
                if (!match) {
                    errors.push({
                        line: i + 1, column: lines[i].indexOf('senddatato'),
                        message: 'senddatato expects an argument and must end with ".", e.g. senddatato(url).',
                        severity: 'error'
                    });
                }
            }
        }

        // ─── 11. Check ask (conditional) syntax ───────────────────────────
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('ask ') && !line.startsWith('#')) {
                // ask should have a condition and { block }
                if (!line.includes('{')) {
                    errors.push({
                        line: i + 1, column: 0,
                        message: 'ask statement should include a condition and { block }',
                        severity: 'warning'
                    });
                }
            }
        }

        // ─── Result ───────────────────────────────────────────────────────
        const hasErrors = errors.some(e => e.severity === 'error');

        if (!hasErrors) {
            const warningCount = errors.filter(e => e.severity === 'warning').length;
            if (warningCount > 0) {
                return {
                    success: true,
                    output: `Syntax check passed with ${warningCount} warning(s).`,
                    errors: errors.length > 0 ? errors : undefined
                };
            }
            return {
                success: true,
                output: '✓ Syntax check passed — no errors found.'
            };
        }

        return {
            success: false,
            output: `✗ Found ${errors.filter(e => e.severity === 'error').length} error(s) and ${errors.filter(e => e.severity === 'warning').length} warning(s).`,
            errors
        };
    }

    // ─── Helper Methods ──────────────────────────────────────────────────

    private findLineWith(lines: string[], text: string): number {
        // Special section markers that start with # but are NOT comments
        const sectionMarkers = ['#library#', '#variables#', '#endregion'];

        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (lines[i].includes(text)) {
                // Allow section markers like #library# and #variables#
                if (sectionMarkers.some(marker => trimmed === marker || trimmed.startsWith(marker))) {
                    return i;
                }
                // Skip regular comment lines (start with # but aren't section markers)
                if (!trimmed.startsWith('#')) {
                    return i;
                }
            }
        }
        return -1;
    }

    private extractBlock(lines: string[], startLine: number): string[] {
        const block: string[] = [];
        let depth = 0;
        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            for (const ch of line) {
                if (ch === '{') {
                    depth++;
                } else if (ch === '}') {
                    depth--;
                }
            }
            block.push(line);
            if (depth === 0 && i > startLine) {
                break;
            }
        }
        return block;
    }

    private checkBraces(lines: string[]): SyntaxError[] {
        const errors: SyntaxError[] = [];
        let depth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Skip comment-only lines
            if (line.startsWith('#') && !line.includes('#library#') && !line.includes('#variables#')) {
                continue;
            }
            // Skip string contents (basic — doesn't handle multi-line strings)
            const cleanLine = line.replace(/"[^"]*"/g, '');

            for (const ch of cleanLine) {
                if (ch === '{') {
                    depth++;
                } else if (ch === '}') {
                    depth--;
                    if (depth < 0) {
                        errors.push({
                            line: i + 1, column: cleanLine.indexOf('}'),
                            message: 'Unexpected closing brace "}"',
                            severity: 'error'
                        });
                        depth = 0;
                    }
                }
            }
        }

        if (depth > 0) {
            errors.push({
                line: 0, column: 0,
                message: `Missing ${depth} closing brace(s) "}"`,
                severity: 'error'
            });
        }

        return errors;
    }

    private checkTerminators(lines: string[]): SyntaxError[] {
        const errors: SyntaxError[] = [];
        // Keywords that require a "." terminator (outside of blocks)
        const requiresTerminator = ['saveto', 'senddatato', 'call'];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#') || line.startsWith('{') || line.startsWith('}')) {
                continue;
            }

            for (const keyword of requiresTerminator) {
                if (line.includes(keyword) && !line.endsWith('.') && !line.endsWith('{')) {
                    // Only warn if the keyword is actually used as a statement
                    const idx = line.indexOf(keyword);
                    if (idx === 0 || line[idx - 1] === ' ' || line[idx - 1] === '\t') {
                        errors.push({
                            line: i + 1, column: idx,
                            message: `"${keyword}" statement should end with "."`,
                            severity: 'warning'
                        });
                    }
                }
            }
        }

        return errors;
    }

    private fsPathFromUri(uri: string): string {
        const parsed = new URL(uri);
        let filePath = decodeURIComponent(parsed.pathname);
        if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:/)) {
            filePath = filePath.substring(1);
        }
        return filePath;
    }
}
