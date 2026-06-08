/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';

/**
 * Arduino-style "New Sketch" dialog.
 *
 * Shows a simple modal dialog prompting the user for a sketch name.
 * The `.airo` extension is fixed and automatic — the user only enters
 * the sketch name (e.g. "my_sketch" → creates "my_sketch/my_sketch.airo").
 *
 * Uses Theia's built-in `SingleTextInputDialog` which provides:
 *  - Modal overlay with title
 *  - Text input with validation
 *  - OK / Cancel buttons
 *  - Keyboard support (Enter to confirm, Escape to cancel)
 *
 * Validation:
 * - Name cannot be empty
 * - Name must start with a letter (to be a valid C identifier for Arduino)
 * - Only alphanumeric characters, underscores, and hyphens are allowed
 * - Name must not exceed 63 characters
 *
 * IMPORTANT: This class is NOT an Inversify @injectable(). It extends
 * SingleTextInputDialog which creates DOM elements in its constructor.
 * If registered as an Inversify singleton, any constructor failure would
 * crash the entire Theia frontend module, leaving the user stuck on
 * the preload.html splash screen. Instead, instantiate on-demand in
 * the newSketch() method where errors can be safely caught.
 */
export class NewSketchDialog extends SingleTextInputDialog {

    constructor() {
        super({
            title: 'Create New Sketch',
            initialValue: 'my_sketch',
            placeholder: 'Enter sketch name',
            validate: (value: string) => {
                const trimmed = value.trim();
                if (!trimmed) {
                    return 'Sketch name cannot be empty.';
                }
                if (!/^[a-zA-Z]/.test(trimmed)) {
                    return 'Sketch name must start with a letter.';
                }
                if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(trimmed)) {
                    return 'Only letters, numbers, underscores, and hyphens allowed.';
                }
                if (trimmed.length > 63) {
                    return 'Sketch name is too long (max 63 characters).';
                }
                return false;
            }
        });
    }
}
