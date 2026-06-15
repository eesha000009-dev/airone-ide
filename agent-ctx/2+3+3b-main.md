# Task 2+3+3b - Fix New File Dialog

## Work Record

### Changes Made

1. **`theia-extensions/airo/src/browser/airo-contribution.ts`**:
   - Added `SingleTextInputDialog` import from `@theia/core/lib/browser/dialogs`
   - Replaced `AIRO_NEW_SKETCH_COMMAND` with `AIRO_NEW_FILE_COMMAND` (id: `airo.newFile`, label: `New`)
   - Replaced `newSketch()` method: now uses `SingleTextInputDialog` instead of `QuickInputService`
     - Dialog title: "New Sketch", initial value: "my_sketch", placeholder: "Enter sketch name"
     - Validation: must start with letter, only alphanumeric/underscore/hyphen, max 63 chars
     - Appends `.airo` suffix span after dialog opens via setTimeout
   - Updated `registerCommands()`: uses `AIRO_NEW_FILE_COMMAND` instead of `AIRO_NEW_SKETCH_COMMAND`
   - Updated `registerMenus()`: "New" label instead of "New Sketch", uses `AIRO_NEW_FILE_COMMAND.id`
   - Added `Ctrl+N` keybinding for `AIRO_NEW_FILE_COMMAND`
   - Updated `setupMenuItemHiding()`:
     - Removed new file commands from `unwantedCommands` (they're now redirected, not blocked)
     - Added `newFileCommands` set for redirecting to `airo.newFile`
     - Command interception: redirects new file commands to `airo.newFile`, blocks other unwanted commands
     - Updated `hiddenLabels`: removed "New File" and "New Text File" (redirected, not hidden)
   - Updated `registerMenus()` `unwantedFileCommands`: removed new file commands from the list

2. **`theia-extensions/airo/src/browser/airo-toolbar-contribution.ts`**:
   - Added "+" (New File) button in the toolbar's left group after Upload button
   - Button triggers `this.commandService.executeCommand('airo.newFile')`
   - Styled with transparent background, hover effect, border

## Summary
- New File popup uses SingleTextInputDialog with .airo extension suffix displayed
- Theia's "New File" commands are redirected to our sketch creation dialog
- Removed separate "New Sketch" command/menu entry
- + button in toolbar creates .airo sketches
- Ctrl+N keyboard shortcut added
