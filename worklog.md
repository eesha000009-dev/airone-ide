# Airone IDE Worklog

---
Task ID: 1
Agent: Rebranding Agent
Task: Rebrand Eclipse Theia IDE as Airone IDE

Work Log:
- Cloned Eclipse Theia IDE (MIT licensed) from eclipse-theia/theia-ide
- Rebranded all package.json files (root, electron, browser, product, launcher, updater, airo)
- Updated electron-builder.yml for Airone branding (appId, productName, copyright, protocols)
- Created AironeIDESplash.svg with dark theme and robot icon
- Updated branding-util.tsx with Airone-specific text
- Updated getting-started-widget.tsx for Airone IDE
- Updated about-dialog.tsx for Airone IDE
- Created .airo language extension directory structure
- Removed all @theia/ai-* dependencies (not needed for robotics IDE)
- Removed Java plugin dependencies
- Removed electron-next application (not needed)
- Updated lerna version to 0.1.0
- Set git remote to eesha000009-dev/airone-ide

Stage Summary:
- All branding changed from "Eclipse Theia IDE" to "Airone IDE"
- Configuration folder changed from .theia-ide to .airone-ide
- MIT license preserved throughout
- .airo language extension skeleton created

---
Task ID: 2-a
Agent: Backend Developer
Task: Build .airo compiler backend and serial monitor

Work Log:
- Created airo-protocol.ts with RPC interfaces (CompileRequest, CompileResult, SerialPortInfo)
- Created airo-compiler-service.ts (backend) that spawns Python airo-compiler process
- Created airo-serial-service.ts (backend) for serial port communication via serialport npm
- Created airo-backend-module.ts (DI module for backend)
- Created airo-serial-widget.tsx (ReactWidget serial monitor with port/baud/connect/clear UI)
- Created airo-language-contribution.ts (TextMate grammar for .airo)
- Created airo-contribution.ts (commands: compile, flash, serial monitor, new file + keybindings)
- Created airo-frontend-module.ts (DI module for frontend)
- Updated package.json with backend module entry and serialport dependency

Stage Summary:
- Full .airo language support with TextMate grammar
- Compile command with output panel integration
- Serial Monitor widget with port selection, baud rate, connect/disconnect
- Backend compiler service that calls Python airo-compiler
- Backend serial service for ESP32 communication
- Keybindings: Ctrl+Shift+B (compile), Ctrl+Shift+U (flash)

---
Task ID: 2-b
Agent: Build Engineer
Task: Fix build issues and set up CI/CD

Work Log:
- Fixed airo-serial-widget.ts → .tsx for JSX support
- Fixed KeybindingContribution import path (from @theia/core/lib/common to @theia/core/lib/browser/keybinding)
- Fixed monaco namespace imports to use proper Theia API
- Removed LanguageConfigurationContribution (not available in Theia 1.72.0-next.42)
- Browser build succeeds
- Created GitHub Actions workflow (build-airone.yml) for Windows and Linux builds
- Cleaned up old Theia-specific workflows
- Installed yarn dependencies with --ignore-scripts
- All extensions compile successfully

Stage Summary:
- Browser build works: `yarn build:applications:dev` succeeds
- Electron build needs CI/CD (native modules require system deps)
- GitHub Actions workflow created for Windows + Linux builds
- All TypeScript extensions compile without errors

---
Task ID: 3
Agent: IDE Refactoring Agent
Task: Refactor Airone IDE to be more Arduino-like per user feedback

Work Log:
- Created AiroSidebarWidget (ReactWidget) with Arduino-like controls:
  - ✓ Verify button (green) — compile & check syntax
  - → Upload button (blue) — compile & flash to board
  - Board selector dropdown (ESP32 DevKit, S2, S3, C3, ESP8266)
  - Port selector dropdown with refresh and quick-pick
  - Serial Monitor toggle button
  - New Sketch, Examples, Language Reference quick actions
  - Status bar showing selected board and port
- Created AiroSidebarContribution (extends AbstractViewContribution) to:
  - Add Airone icon to the activity sidebar bar
  - Auto-open sidebar on startup (initializeLayout)
  - Register keyboard shortcut Ctrl+Shift+A to show sidebar
- Created AiroBuiltInCompiler (TypeScript, no Python dependency):
  - Checks for required sections: Pin defi, loop, #library#, #variables#
  - Validates brace matching
  - Validates statement terminators
  - Validates read_for/actfor/senddatato/ask syntax
  - Returns structured errors with line/column info
  - Works without Python — fixes "No module named airo_compiler" error
- Updated AiroCompilerService to use two-tier compilation:
  - Tier 1: Built-in TypeScript verifier (always available, no dependencies)
  - Tier 2: Python airo_compiler (when available, for full transpilation)
  - Falls back gracefully when Python is not installed
- Updated AiroSketchService to use built-in compiler for verify
- Updated AiroContribution to remove toolbar registration (moved to sidebar)
- Improved Extensions → Libraries renaming in TheiaIDEContribution:
  - More comprehensive DOM patching (8 different selectors)
  - MutationObserver with immediate initial rename
  - Also renames tooltips
- Created CSS styles for Airone sidebar panel (airo-sidebar.css)
  - Arduino-like green verify button, blue upload button
  - Clean dropdown styling, status bar, compiling indicator
- Created bundled .airo VS Code extension (plugins/airo-language/):
  - package.json with language, grammar, snippets, commands, keybindings, configuration
  - airo.tmLanguage.json (TextMate grammar)
  - language-configuration.json (bracket matching, comments, folding)
  - airo-snippets.json (sketch, pin, loop, readfor, actfor, ask, send, blink, wifi)
  - extension.js (VS Code extension entry point)
  - airo-icon.svg (extension icon)
- Updated electron-app/package.json:
  - Removed unnecessary Theia dependencies (bulk-edit, console, debug, external-terminal, keymaps, metrics, outline-view, task)
  - Added file exclusion preferences (hide .airone-ide, .theia, build folders)
  - Added single-tab editor preference
- Updated CI/CD workflow to try installing airo_compiler Python package
- Updated product CSS with Airone green branding color

Stage Summary:
- Airone sidebar panel with Arduino-like controls in the activity bar
- Built-in TypeScript compiler fixes the "No module named airo_compiler" error
- Extensions renamed to Libraries throughout the UI
- .airo language extension bundled as a VS Code plugin
- Unnecessary IDE features removed from dependencies
- Hidden config folders from file explorer
- Single-tab editor mode configured

---
Task ID: 4
Agent: Major Refactoring Agent
Task: Fix critical bugs, improve UI to be more Arduino-like, add auto-update

Work Log:
- Fixed "No active editor" bug in Verify/Upload: now checks all open editors, not just activeEditor
- Fixed "prompt() is not supported" in New Sketch: replaced with SingleTextInputDialog
- Fixed Examples not opening: now creates a sketch from example code and opens it in editor
- Added newSketchFromExample method to AiroSketchClient protocol and backend
- Added MessageService injection to AiroSerialWidget for better error reporting
- Removed Testing, Debug, Search from sidebar via CSS selectors
- Added DOM-based menu hiding: Selection, Go, Run, Terminal, Help removed from menu bar
- Added Compile, Verify, Upload as top-level menu entries in the menu bar
- Menu bar is now: File | Edit | View | Compile | Verify | Upload
- Configured electron-updater for GitHub releases auto-update
- Updated electron-builder.yml with GitHub provider for publish
- Branded updater messages from "Theia IDE" to "Airone IDE"
- Created bundled airo_compiler Python module (airo-compiler/airo_compiler/)
  - Supports: python -m airo_compiler <file.airo> --target esp32 --output <dir>
  - Includes .airo to C++ transpiler for ESP32/ESP8266
  - Bundled as extraResource in electron-builder config
- Removed @theia/search-in-workspace dependency from electron-app
- Added files.autoSave preference for better UX
- Added theia-workspace to files.exclude preferences
- Fixed TypeScript error in updater (response parameter implicit any type)
- Removed broken deploy step from CI workflow

Stage Summary:
- All critical bugs fixed (verify/upload, new sketch, examples, serial monitor)
- UI simplified: only File/Edit/View/Compile/Verify/Upload menus
- Sidebar cleaned: only Airone panel, File Explorer, Source Control, Libraries remain
- Auto-update configured for GitHub releases
- Bundled airo_compiler Python module for full transpilation support
- Both Windows and Linux CI/CD builds succeeded
