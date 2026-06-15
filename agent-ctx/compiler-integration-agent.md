# Task: Real Compiler Integration for Airone IDE

## Task ID: compiler-integration

## Summary
Successfully integrated the real Python airo-compiler into the Airone IDE's API routes, replacing simulated compile/flash/serial operations with actual compiler invocations and tool detection.

## Files Modified

### 1. `/home/z/my-project/src/app/api/compile/route.ts`
- **Before**: Simulated compilation with fake output
- **After**: Calls real Python airo-compiler via `execFile('python3', ['-m', 'airo_compiler', ...])`
- Sets `PYTHONPATH` to include `/home/z/my-project/airo-compiler`
- Writes .airo code to temp file, runs compiler, reads all 6 generated C++ files
- Returns `{ success, output, errors[], generatedFiles: {filename: content}, generatedCode }`
- Properly parses compiler errors (LEX ERROR, PARSE ERROR, SAFETY ERROR, warnings)
- Cleans up temp files after compilation
- Handles timeouts (30s) and process kills

### 2. `/home/z/my-project/src/app/api/serial/route.ts`
- **Before**: Hardcoded fake serial ports
- **After**: Dynamic import of `serialport` npm package with graceful fallback
- GET: Tries to import serialport, returns real port data if available, empty list with note if not
- Identifies ESP32-specific chips: CP210x, CH340, FTDI, ESP32 native USB
- POST: Handles connect/disconnect/send/list actions (simulated for web IDE)
- Uses `import(/* webpackIgnore: true */ 'serialport')` to avoid build-time module resolution

### 3. `/home/z/my-project/src/app/api/flash/route.ts`
- **Before**: Simulated flash with fake progress
- **After**: Full pipeline with step-by-step status reporting
- Step 1: Compiles .airo code directly (not via API call) using Python compiler
- Step 2: Detects esptool via `which esptool.py`, `which esptool`, `python3 -m esptool --version`
- Step 3: Detects serial ports via `ls /dev/ttyUSB* /dev/ttyACM*`
- Step 4: Reports firmware build requirements (Arduino CLI/PlatformIO)
- Step 5: Constructs esptool flash command
- Returns detailed step status, esptool availability, and canFlash flag

### 4. `/home/z/my-project/src/stores/ide-store.ts`
- **Before**: `compile()` and `flash()` used `setTimeout` to simulate delays
- **After**: Both call real API endpoints via `fetch()`
- `compile()`: POSTs to `/api/compile`, displays real compiler output, errors, and generated files
- `flash()`: POSTs to `/api/flash`, displays step-by-step pipeline status
- Both handle network errors, parse real error messages, and update terminal with actual output

### 5. `/home/z/my-project/src/app/api/test-pipeline/route.ts` (NEW)
- Diagnostics endpoint that tests the entire toolchain
- Test 1: Python3 availability
- Test 2: airo_compiler import with PYTHONPATH
- Test 3: Jinja2 availability
- Test 4: esptool detection (3 methods)
- Test 5: serialport npm availability
- Test 6: Full compile pipeline (writes sample .airo, compiles, checks all 6 output files)
- Returns JSON with pass/fail/warn for each test

### 6. Supporting Changes
- `/home/z/my-project/src/types/native-modules.d.ts` - Type declarations for serialport
- `/home/z/my-project/src/components/ui/resizable.tsx` - Updated for react-resizable-panels v4 API (Group/Panel/Separator)
- `/home/z/my-project/next.config.ts` - Added turbopack root and serverExternalPackages for serialport
- `/home/z/my-project/tsconfig.json` - Rewritten for Next.js 16 with proper paths and JSX config

## Test Results
All 4 API endpoints verified working:
- `/api/compile` → ✅ Successfully compiles .airo → 6 C++ files
- `/api/serial` → ✅ Gracefully handles missing serialport package
- `/api/flash` → ✅ Compilation succeeds, esptool detection works, step-by-step output
- `/api/test-pipeline` → ✅ 4/6 tests pass (esptool and serialport are warnings, not failures)
- Main page → ✅ HTTP 200

## Known Issues
- Disk space is tight in the sandbox (~530MB free), causing occasional server crashes during heavy compilation
- serialport npm package is not installed (requires native compilation) - handled gracefully
- esptool is not installed in the sandbox - handled gracefully with install instructions
- The Turbopack dev server can crash when compiling many routes simultaneously
