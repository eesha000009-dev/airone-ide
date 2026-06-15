# Arduino IDE 2.x Analysis for .airo Language Support

**Date:** 2024-05-24  
**Arduino IDE Version:** 2.3.9  
**Repository:** https://github.com/arduino/arduino-ide  
**Clone Location:** `/home/z/my-project/arduino-ide/`

---

## 1. Project Structure Overview

The Arduino IDE 2.x is built on top of **Eclipse Theia** (v1.57.0), a VS Code-compatible IDE framework. It uses TypeScript, React, and InversifyJS for dependency injection.

```
arduino-ide/
├── arduino-ide-extension/       # Main Theia extension (ALL core logic)
│   ├── package.json             # Extension manifest, Theia extension points
│   ├── src/
│   │   ├── browser/             # Frontend (UI) code
│   │   │   ├── arduino-ide-frontend-module.ts  # DI module (bindings)
│   │   │   ├── contributions/   # Command/menu/keybinding contributions
│   │   │   ├── theia/           # Theia framework overrides
│   │   │   ├── widgets/         # UI widgets (sketchbook, boards, etc.)
│   │   │   ├── dialogs/         # Dialog components
│   │   │   ├── boards/          # Board selection UI
│   │   │   ├── serial/          # Serial monitor & plotter
│   │   │   ├── create/          # Arduino Cloud integration
│   │   │   ├── auth/            # Authentication (Arduino Cloud)
│   │   │   ├── hosted/          # VS Code plugin host support
│   │   │   └── style/           # CSS styles
│   │   ├── node/                # Backend (server) code
│   │   │   ├── arduino-ide-backend-module.ts  # DI module (bindings)
│   │   │   ├── sketches-service-impl.ts       # Sketch management (CRITICAL)
│   │   │   ├── core-service-impl.ts           # Compile/Upload (CRITICAL)
│   │   │   ├── arduino-daemon-impl.ts         # Arduino CLI daemon
│   │   │   ├── boards-service-impl.ts         # Board management
│   │   │   ├── library-service-impl.ts        # Library management
│   │   │   ├── config-service-impl.ts         # Configuration
│   │   │   ├── theia/plugin-ext/              # Plugin system overrides
│   │   │   └── cli-protocol/                 # gRPC protocol (auto-generated)
│   │   ├── common/              # Shared protocol/interfaces
│   │   │   └── protocol/
│   │   │       ├── sketches-service.ts        # Sketch service interface
│   │   │       ├── core-service.ts            # Core service interface
│   │   │       └── ...                        # Other service interfaces
│   │   ├── electron-main/       # Electron main process
│   │   └── electron-browser/    # Electron-specific frontend
│   └── scripts/                 # Build/download scripts
├── electron-app/                # Electron application wrapper
├── i18n/                        # Internationalization files
├── static/                      # Static assets
└── package.json                 # Root monorepo config (Lerna)
```

---

## 2. Key Files for Language Modification

### 2.1 Sketch File Extensions & Recognition

**File:** `arduino-ide-extension/src/common/protocol/sketches-service.ts` (lines 335-350)

```typescript
export namespace Extensions {
    export const DEFAULT = '.ino';
    export const MAIN = [DEFAULT, '.pde'];
    export const SOURCE = ['.c', '.cpp', '.S', '.cxx', '.cc'];
    export const CODE_FILES = [
        ...MAIN, ...SOURCE, '.h', '.hh', '.hpp', '.tpp', '.ipp',
    ];
    export const ADDITIONAL = [...CODE_FILES, '.json', '.md', '.adoc'];
    export const ALL = Array.from(new Set([...MAIN, ...SOURCE, ...ADDITIONAL]));
}
```

**To add .airo support, you must:**
- Add `'.airo'` to the `MAIN` array (so it's recognized as a main sketch file)
- Add `'.airo'` to `CODE_FILES` (so it appears in sketch file lists)

### 2.2 Default New Sketch Template

**File:** `arduino-ide-extension/src/node/sketches-service-impl.ts` (lines 55-64, 385-445)

The default `.ino` template is hardcoded:
```typescript
const DefaultIno = `void setup() {
  // put your setup code here, to run once:

}

void loop() {
  // put your main code here, to run repeatedly:

}
`;
```

The `createNewSketch()` method (line 385) creates a sketch with:
- Auto-generated name (e.g., `sketch_may24a`)
- A `.ino` file as the main sketch file
- Content from `DefaultIno` or the `arduino.sketch.inoBlueprint` setting

**Key code (line 438):**
```typescript
const sketchFile = path.join(sketchDir, `${sketchName}.ino`);
```

**The `loadInoContent()` method (line 712)** supports a custom blueprint via settings:
```typescript
const inoBlueprintPath = settings['arduino.sketch.inoBlueprint'];
```

**To add .airo support:**
- Modify `createNewSketch()` to detect or allow .airo as an alternative
- Add an `.airo` template (or use the existing airo extension template)
- Consider adding a setting like `arduino.sketch.airoBlueprint`

### 2.3 Sketch Discovery

**File:** `arduino-ide-extension/src/node/sketches-service-impl.ts` (line 853)

The `discoverSketches()` function uses glob patterns:
```typescript
const pathToAllSketchFiles = await glob(
    '/!(libraries|hardware)/**/*.{ino,pde}', { root }
);
```

And on line 858:
```typescript
pathToAllSketchFiles.push(...(await glob('/*.{ino,pde}', { root })));
```

**To add .airo support:**
- Change the glob patterns to `*.{ino,pde,airo}`

### 2.4 Sketch Validation

**File:** `arduino-ide-extension/src/node/sketches-service-impl.ts` (lines 796-801)

The `isAccessibleSketchPath()` function checks for `.ino` files:
```typescript
if (stats.isFile()) {
    return path.endsWith('.ino') ? path : undefined;
}
```

And on line 799:
```typescript
.filter((entry) => entry.isFile() && entry.name.endsWith('.ino'))
```

**To add .airo support:**
- Also check for `.airo` extension in these locations

### 2.5 Language Server Integration (C++ / Ino)

**File:** `arduino-ide-extension/src/browser/contributions/ino-language.ts`

This is the **InoLanguage** contribution that manages the Arduino Language Server (based on clangd). It:
- Starts/stops the language server based on board selection
- Connects to the Arduino CLI daemon via gRPC
- Manages real-time diagnostics
- Notifies the language server after compilation completes

**For .airo support:**
- This language server is specifically for C++/Arduino code
- .airo files would NOT use the Arduino Language Server directly
- Instead, the airo_compiler.py would transpile .airo to .ino before compilation
- You may want to create a separate `AiroLanguage` contribution class

---

## 3. How the New Sketch Template Works

1. **User triggers:** `Ctrl+Cmd+N` → `NewSketch.Commands.NEW_SKETCH` command
2. **Command handler:** `NewSketch.newSketch()` (file: `contributions/new-sketch.ts`)
3. **Service call:** `this.sketchesService.createNewSketch()`
4. **Backend implementation:** `SketchesServiceImpl.createNewSketch()` (file: `sketches-service-impl.ts`)
   - Creates a temp folder with `TempSketchPrefix`
   - Auto-generates a unique sketch name
   - Writes `DefaultIno` content to `{sketchName}.ino`
   - Loads the sketch via the Arduino CLI gRPC `LoadSketch` call
5. **Frontend opens:** The workspace opens the new sketch URI

**The content is loaded via `loadInoContent()` (line 712):**
1. First checks for `arduino.sketch.inoBlueprint` setting
2. If set and file exists, reads content from that file
3. Otherwise, uses the hardcoded `DefaultIno` constant

---

## 4. How Compilation is Triggered

### 4.1 Verify/Compile Flow

1. **User triggers:** `Ctrl+Cmd+R` → `VerifySketch.Commands.VERIFY_SKETCH` command
2. **Command handler:** `VerifySketch.verifySketch()` (file: `contributions/verify-sketch.ts`)
3. **Options assembly:** Collects sketch, FQBN, source overrides, debug settings
4. **Service call:** `coreService.compile(options, token)`
5. **Backend implementation:** `CoreServiceImpl.compile()` (file: `core-service-impl.ts`)
   - Creates a gRPC `CompileRequest`
   - Sends to the Arduino CLI daemon
   - Streams compile output back to the frontend
   - Handles errors and produces compile summary

### 4.2 The Arduino CLI

The compilation is handled by the **Arduino CLI** (`arduino-cli`), which is a separate Go binary. It:
- Preprocesses `.ino` files into valid C++
- Invokes the toolchain (gcc, avr-gcc, etc.)
- Manages library dependencies
- Outputs compiled binaries

**For .airo support:**
- Before compilation, `.airo` files must be transpiled to `.ino` (or `.cpp`) using the `airo_compiler.py`
- This pre-compilation step should be injected into the verify/upload pipeline
- The `sourceOverride` mechanism in `CoreService.Options.Compile` could be leveraged

### 4.3 Source Override Mechanism

The `mergeSourceOverrides()` method in `core-service-impl.ts` (line 538) allows overriding source content before compilation:
```typescript
private mergeSourceOverrides(req, options: CoreService.Options.Compile): void {
    const sketchPath = FileUri.fsPath(options.sketch.uri);
    for (const uri of Object.keys(options.sourceOverride)) {
        const content = options.sourceOverride[uri];
        if (content) {
            const relativePath = path.relative(sketchPath, FileUri.fsPath(uri));
            req.getSourceOverrideMap().set(relativePath, content);
        }
    }
}
```

**This is a potential integration point:** The .airo → .ino transpilation result could be injected as a source override.

---

## 5. How Extensions/Plugins Are Loaded

The Arduino IDE uses Theia's plugin system, which is compatible with **VS Code extensions**.

### 5.1 Plugin Discovery

**File:** `arduino-ide-extension/src/node/theia/plugin-ext/plugin-reader.ts`

The `HostedPluginReader` reads plugin contributions (languages, grammars, commands, etc.) from plugin `package.json` files.

### 5.2 Plugin Deployment

**File:** `arduino-ide-extension/src/node/theia/plugin-ext/plugin-deployer.ts`

The `PluginDeployer_GH_12064` class handles plugin resolution from local directories.

### 5.3 Built-in Plugins

The Arduino IDE ships with built-in VS Code extensions, including:
- **arduino-tools** (Arduino Language Server integration, board configuration)
- **vscode-arduino-tools** (debugger integration)
- **cortex-debug** (debug support)

These are bundled in the application and loaded automatically.

### 5.4 The Existing .airo Extension

A pre-built VS Code extension for .airo already exists at:
`/home/z/my-project/upload/airone_system_extracted/arduino_ide_extension/`

It includes:
- `package.json` — Language, grammar, snippets, and commands registration
- `src/extension.ts` — Compile, new robot, sync-to-backbone commands
- `syntaxes/airo.tmLanguage.json` — TextMate grammar for syntax highlighting
- `language-configuration.json` — Bracket matching, auto-closing, indentation
- `snippets/airo.json` — Code snippets for robot template, pin definition, etc.

---

## 6. Recommended Approach for Adding .airo Support

There are **two complementary approaches**:

### Approach A: VS Code Extension (Plugin) — **Recommended First Step**

This is the least invasive approach. Package the existing `.airo` extension as a Theia/VS Code plugin.

**Steps:**
1. Build the `.airo` extension from `/home/z/my-project/upload/airone_system_extracted/arduino_ide_extension/`
2. Package it as a `.vsix` file
3. Deploy it as a built-in plugin in the Arduino IDE
4. The plugin system will automatically:
   - Register the `airo` language (`.airo` file extension)
   - Load the TextMate grammar for syntax highlighting
   - Register code snippets
   - Activate the extension commands (compile, new robot, sync)

**Plugin location in the IDE:**
The built-in plugins are referenced in the Electron app configuration. Look at the `arduino-ide-extension/package.json` for plugin paths.

### Approach B: Core IDE Modification — **For Deep Integration**

Modify the Arduino IDE source code to natively support `.airo` files.

**Files that need modification:**

| File | Change |
|------|--------|
| `src/common/protocol/sketches-service.ts` | Add `'.airo'` to `Extensions.MAIN` and `Extensions.CODE_FILES` |
| `src/node/sketches-service-impl.ts` | Update `discoverSketches()` glob to include `.airo`; update `isAccessibleSketchPath()` to recognize `.airo`; add `.airo` template support in `createNewSketch()` |
| `src/browser/contributions/new-sketch.ts` | Add "New Airone Sketch" command alongside "New Sketch" |
| `src/browser/contributions/verify-sketch.ts` | Add pre-compilation step: .airo → .ino transpilation |
| `src/browser/contributions/ino-language.ts` | Skip Arduino Language Server for .airo files |
| `src/browser/arduino-ide-frontend-module.ts` | Register new `AiroSketch` contribution class |
| `src/browser/contributions/open-sketch-files.ts` | Handle `.airo` as main sketch file type |
| `src/node/core-service-impl.ts` | Inject source override from transpiled .airo → .ino |

### Approach C: Hybrid (Recommended Final Approach)

1. **Start with Approach A** — Deploy the .airo extension as a built-in plugin for syntax highlighting, snippets, and basic commands
2. **Add core modifications incrementally:**
   - Add `.airo` to the sketch file extension lists
   - Create a new `NewAiroSketch` command with the Airone robot template
   - Implement pre-compilation transpilation in the verify/upload pipeline
   - Add a custom `AiroLanguage` contribution that skips the C++ language server for .airo files but could integrate a future .airo language server

---

## 7. Specific File Paths That Need Modification

### Critical Files (Core Integration)

1. **`arduino-ide-extension/src/common/protocol/sketches-service.ts`**
   - Lines 335-350: `Extensions` namespace — add `.airo` to `MAIN` and `CODE_FILES`

2. **`arduino-ide-extension/src/node/sketches-service-impl.ts`**
   - Line 55-64: `DefaultIno` — add `DefaultAiro` template
   - Line 438: `sketchFile` creation — support `.airo` extension
   - Lines 712-737: `loadInoContent()` — add `loadAiroContent()` method
   - Lines 796-801: `isAccessibleSketchPath()` — add `.airo` check
   - Lines 799-800: sketch file filter — add `.airo` 
   - Lines 853-858: `discoverSketches()` glob — add `.airo` to patterns

3. **`arduino-ide-extension/src/browser/contributions/verify-sketch.ts`**
   - Lines 148-206: `verifySketch()` — add .airo pre-compilation step
   - Lines 208-234: `options()` — detect .airo sketch and add source override

4. **`arduino-ide-extension/src/node/core-service-impl.ts`**
   - Lines 538-550: `mergeSourceOverrides()` — inject transpiled .airo content

5. **`arduino-ide-extension/src/browser/contributions/ino-language.ts`**
   - Add logic to skip language server for .airo sketches

6. **`arduino-ide-extension/src/browser/arduino-ide-frontend-module.ts`**
   - Register new `NewAiroSketch` contribution

### New Files to Create

1. **`arduino-ide-extension/src/browser/contributions/airo-sketch.ts`** — New Airone sketch command with robot template
2. **`arduino-ide-extension/src/browser/contributions/airo-language.ts`** — Airo language contribution (skips C++ LS)
3. **`arduino-ide-extension/src/node/airo-compiler-service.ts`** — Service to invoke airo_compiler.py

### Plugin Integration Files

1. **`electron-app/package.json`** — Add .airo extension as a built-in plugin
2. **`arduino-ide-extension/src/node/theia/plugin-ext/plugin-reader.ts`** — Possibly add .airo mapper

### Pre-existing Extension (Already Available)

The VS Code extension at `/home/z/my-project/upload/airone_system_extracted/arduino_ide_extension/` already provides:
- Language registration (`airo` language ID, `.airo` extension)
- TextMate grammar (`syntaxes/airo.tmLanguage.json`)
- Language configuration (`language-configuration.json`)
- Code snippets (`snippets/airo.json`)
- Commands: `airo.compile`, `airo.newRobot`, `airo.syncToBackbone`

---

## 8. Compilation Pipeline for .airo Files

The proposed compilation flow for `.airo` files:

```
.airo source file
    ↓
airo_compiler.py (Python transpiler)
    ↓
.ino (C++/Arduino code)
    ↓
Arduino CLI (preprocessor + gcc toolchain)
    ↓
Binary firmware (.hex / .bin)
```

**Integration point:** The `sourceOverride` mechanism in `CoreServiceImpl.compile()` can be used to inject the transpiled `.ino` content. Before compilation:
1. Read the `.airo` main file
2. Invoke `airo_compiler.py` to generate `.ino` content
3. Pass the generated content as a `sourceOverride` for the `.airo` file
4. The Arduino CLI will compile the overridden content

---

## 9. Key Dependencies and Architecture Notes

- **Theia Version:** 1.57.0 (VS Code compatible)
- **Monaco Editor:** 1.83.101 (TextMate grammar support built-in)
- **Arduino CLI:** v1.5.0 (gRPC-based, handles compilation/upload)
- **Arduino Language Server:** commit 05ec308 (clangd-based, for C++/Arduino)
- **Node.js:** Requires >=18.17.0 <21 (current env has v24.15.0, may cause issues)
- **Build System:** Lerna monorepo, TypeScript, Webpack
- **Dependency Injection:** InversifyJS (all services are DI-managed)

### npm Install Status
- `npm install --ignore-scripts` completed successfully (1248 packages installed)
- Native module compilation (`keytar`) failed due to missing `libsecret-1-dev` — this is non-critical for analysis but would need to be resolved for a full build
