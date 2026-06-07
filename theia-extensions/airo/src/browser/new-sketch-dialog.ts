/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { injectable } from '@theia/core/shared/inversify';
import { SingleTextInputDialog } from '@theia/core/lib/browser/dialogs';

/**
 * Custom "New Sketch" dialog that prompts the user for a sketch name.
 *
 * Modeled after the Arduino IDE's sketch creation dialog — the user only
 * enters a name; the `.airo` extension is appended automatically.
 *
 * Uses Theia's built-in `SingleTextInputDialog` which provides:
 *  - Modal overlay with title
 *  - Text input with validation
 *  - OK / Cancel buttons
 *  - Keyboard support (Enter to confirm, Escape to cancel)
 */
@injectable()
export class NewSketchDialog extends SingleTextInputDialog {

    constructor() {
        super({
            title: 'Create New Sketch (.airo)',
            initialValue: 'my_sketch',
            validate: (value: string) => {
                if (!value || value.trim() === '') {
                    return 'Sketch name cannot be empty.';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value.trim())) {
                    return 'Invalid characters. Use only letters, numbers, hyphens, or underscores.';
                }
                return '';
            }
        });
    }
}
