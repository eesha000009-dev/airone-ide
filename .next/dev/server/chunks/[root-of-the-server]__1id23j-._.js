module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/child_process [external] (child_process, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("child_process", () => require("child_process"));

module.exports = mod;
}),
"[externals]/util [external] (util, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("util", () => require("util"));

module.exports = mod;
}),
"[externals]/fs/promises [external] (fs/promises, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("fs/promises", () => require("fs/promises"));

module.exports = mod;
}),
"[externals]/os [external] (os, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("os", () => require("os"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[project]/src/app/api/test-pipeline/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$child_process__$5b$external$5d$__$28$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/child_process [external] (child_process, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/util [external] (util, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs/promises [external] (fs/promises, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/os [external] (os, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
;
;
;
;
;
;
const execFileAsync = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$util__$5b$external$5d$__$28$util$2c$__cjs$29$__["promisify"])(__TURBOPACK__imported__module__$5b$externals$5d2f$child_process__$5b$external$5d$__$28$child_process$2c$__cjs$29$__["execFile"]);
const AIRO_COMPILER_DIR = '/home/z/my-project/airo-compiler';
async function runTest(name, fn) {
    const start = Date.now();
    try {
        const result = await fn();
        return {
            name,
            ...result,
            duration: Date.now() - start
        };
    } catch (err) {
        return {
            name,
            status: 'fail',
            message: err instanceof Error ? err.message : 'Unknown error',
            duration: Date.now() - start
        };
    }
}
async function checkSerialportAvailability() {
    try {
        const serialport = await import(/* webpackIgnore: true */ 'serialport').catch(()=>null);
        if (serialport && serialport.SerialPort) {
            const SerialPort = serialport.SerialPort;
            if (typeof SerialPort.list === 'function') {
                return {
                    available: true
                };
            }
        }
        return {
            available: false,
            error: 'SerialPort.list not available'
        };
    } catch (err) {
        return {
            available: false,
            error: err instanceof Error ? err.message : 'Module not found'
        };
    }
}
async function GET() {
    const tests = [];
    // ── Test 1: Python availability ──────────────────────────────
    tests.push(await runTest('Python3 Availability', async ()=>{
        try {
            const { stdout } = await execFileAsync('python3', [
                '--version'
            ], {
                timeout: 5000
            });
            return {
                status: 'pass',
                message: `Python3 available: ${stdout.trim()}`
            };
        } catch  {
            return {
                status: 'fail',
                message: 'Python3 is not available or not in PATH',
                details: 'Install Python 3: https://www.python.org/downloads/'
            };
        }
    }));
    // ── Test 2: airo-compiler import ─────────────────────────────
    tests.push(await runTest('Airo Compiler Import', async ()=>{
        try {
            const { stdout, stderr } = await execFileAsync('python3', [
                '-c',
                'import airo_compiler; print(f"Version: {airo_compiler.__version__}")'
            ], {
                timeout: 10000,
                env: {
                    ...process.env,
                    PYTHONPATH: AIRO_COMPILER_DIR
                }
            });
            if (stdout.trim()) {
                return {
                    status: 'pass',
                    message: `airo_compiler imported successfully: ${stdout.trim()}`
                };
            }
            return {
                status: 'fail',
                message: 'airo_compiler import produced no output',
                details: stderr || undefined
            };
        } catch (err) {
            const execErr = err;
            return {
                status: 'fail',
                message: 'Failed to import airo_compiler',
                details: execErr.stderr || (err instanceof Error ? err.message : undefined)
            };
        }
    }));
    // ── Test 3: Jinja2 availability ──────────────────────────────
    tests.push(await runTest('Jinja2 Availability', async ()=>{
        try {
            const { stdout } = await execFileAsync('python3', [
                '-c',
                'import jinja2; print(f"Jinja2 version: {jinja2.__version__}")'
            ], {
                timeout: 5000,
                env: {
                    ...process.env,
                    PYTHONPATH: AIRO_COMPILER_DIR
                }
            });
            return {
                status: 'pass',
                message: `Jinja2 available: ${stdout.trim()}`
            };
        } catch (err) {
            const execErr = err;
            return {
                status: 'fail',
                message: 'Jinja2 is not installed',
                details: 'Install with: pip install Jinja2\n' + (execErr.stderr || (err instanceof Error ? err.message : ''))
            };
        }
    }));
    // ── Test 4: esptool detection ────────────────────────────────
    tests.push(await runTest('esptool Detection', async ()=>{
        const attempts = [
            {
                cmd: 'which',
                args: [
                    'esptool.py'
                ]
            },
            {
                cmd: 'which',
                args: [
                    'esptool'
                ]
            },
            {
                cmd: 'python3',
                args: [
                    '-m',
                    'esptool',
                    '--version'
                ]
            }
        ];
        for (const { cmd, args } of attempts){
            try {
                const { stdout } = await execFileAsync(cmd, args, {
                    timeout: 5000
                });
                if (stdout.trim()) {
                    return {
                        status: 'pass',
                        message: `esptool found: ${cmd} ${args.join(' ')} → ${stdout.trim()}`
                    };
                }
            } catch  {
            // Try next method
            }
        }
        return {
            status: 'warn',
            message: 'esptool not found',
            details: 'Install with: pip install esptool\nChecked: which esptool.py, which esptool, python3 -m esptool'
        };
    }));
    // ── Test 5: serialport npm availability ──────────────────────
    tests.push(await runTest('serialport npm Package', async ()=>{
        const result = await checkSerialportAvailability();
        if (result.available) {
            return {
                status: 'pass',
                message: 'serialport npm package is available'
            };
        }
        return {
            status: 'warn',
            message: 'serialport npm package is not installed',
            details: 'Install with: npm install serialport\n' + 'Note: serialport requires native compilation and may not work in all environments.\n' + (result.error || '')
        };
    }));
    // ── Test 6: Full compile pipeline ────────────────────────────
    tests.push(await runTest('Full Compile Pipeline', async ()=>{
        let tempDir = null;
        try {
            tempDir = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["mkdtemp"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(__TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["default"].tmpdir(), 'airo-pipeline-test-'));
            const sourceFile = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(tempDir, 'test.airo');
            const outputDir = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(tempDir, 'output');
            // Write a sample .airo file
            const sampleCode = `#library#
Pin defi {
    ledpin = 2; output.
}

#variables#
brain_url = "wss://test.local:8080".
call brain_url.

loop {
    read_for(1000) {
    }
    senddatato(brain_url).
    actfor(1000) {
        ledpin.
    }
}`;
            await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["writeFile"])(sourceFile, sampleCode, 'utf-8');
            await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["mkdir"])(outputDir, {
                recursive: true
            });
            // Run the compiler
            const { stdout, stderr } = await execFileAsync('python3', [
                '-m',
                'airo_compiler',
                sourceFile,
                '--target',
                'esp32',
                '--output',
                outputDir
            ], {
                cwd: AIRO_COMPILER_DIR,
                env: {
                    ...process.env,
                    PYTHONPATH: AIRO_COMPILER_DIR
                },
                timeout: 30000
            });
            // Check output files
            const expectedFiles = [
                'main.cpp',
                'pin_map.h',
                'sensor_reader.h',
                'command_executor.h',
                'safety_monitor.h',
                'brain_client.h'
            ];
            const foundFiles = [];
            const missingFiles = [];
            for (const filename of expectedFiles){
                try {
                    const filePath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(outputDir, filename);
                    const content = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["readFile"])(filePath, 'utf-8');
                    if (content.length > 0) {
                        foundFiles.push(filename);
                    } else {
                        missingFiles.push(`${filename} (empty)`);
                    }
                } catch  {
                    missingFiles.push(filename);
                }
            }
            // Clean up
            try {
                if (tempDir) await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["rm"])(tempDir, {
                    recursive: true,
                    force: true
                });
            } catch  {
            // Ignore cleanup errors
            }
            if (foundFiles.length === expectedFiles.length) {
                return {
                    status: 'pass',
                    message: `Full pipeline successful. All ${foundFiles.length} files generated`,
                    details: `Compiler output:\n${stdout}\n` + (stderr ? `Warnings:\n${stderr}\n` : '') + `Generated files: ${foundFiles.join(', ')}`
                };
            } else {
                return {
                    status: 'warn',
                    message: `Pipeline partially successful. ${foundFiles.length}/${expectedFiles.length} files generated`,
                    details: `Found: ${foundFiles.join(', ')}\n` + `Missing: ${missingFiles.join(', ')}\n` + `Output: ${stdout}\n` + (stderr ? `Stderr: ${stderr}` : '')
                };
            }
        } catch (err) {
            // Clean up on error
            try {
                if (tempDir) await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["rm"])(tempDir, {
                    recursive: true,
                    force: true
                });
            } catch  {
            // Ignore cleanup errors
            }
            return {
                status: 'fail',
                message: 'Full pipeline compilation failed',
                details: err instanceof Error ? err.message : 'Unknown error'
            };
        }
    }));
    // ── Build summary ────────────────────────────────────────────
    const summary = {
        total: tests.length,
        passed: tests.filter((t)=>t.status === 'pass').length,
        failed: tests.filter((t)=>t.status === 'fail').length,
        warnings: tests.filter((t)=>t.status === 'warn').length
    };
    const response = {
        timestamp: new Date().toISOString(),
        tests,
        summary
    };
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(response);
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1id23j-._.js.map