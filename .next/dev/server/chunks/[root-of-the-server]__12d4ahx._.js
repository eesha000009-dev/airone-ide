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
"[project]/src/app/api/flash/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
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
async function checkEsptool() {
    const commands = [
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
    for (const { cmd, args } of commands){
        try {
            const { stdout } = await execFileAsync(cmd, args, {
                timeout: 5000
            });
            if (stdout.trim()) {
                if (cmd === 'which') {
                    const espPath = stdout.trim();
                    try {
                        const { stdout: versionOut } = await execFileAsync('python3', [
                            espPath,
                            'version'
                        ], {
                            timeout: 5000
                        });
                        return {
                            available: true,
                            path: espPath,
                            version: versionOut.trim()
                        };
                    } catch  {
                        return {
                            available: true,
                            path: espPath,
                            version: null
                        };
                    }
                }
                return {
                    available: true,
                    path: 'python3 -m esptool',
                    version: stdout.trim()
                };
            }
        } catch  {
        // Command failed, try next
        }
    }
    return {
        available: false,
        path: null,
        version: null
    };
}
async function detectPorts() {
    const ports = [];
    try {
        const { stdout } = await execFileAsync('ls', [
            '/dev/ttyUSB*',
            '/dev/ttyACM*'
        ], {
            timeout: 3000
        });
        const found = stdout.trim().split('\n').filter((p)=>p.startsWith('/dev/'));
        ports.push(...found);
    } catch  {
    // No serial devices found via ls
    }
    return ports;
}
async function compileAiroCode(code, target) {
    let tempDir = null;
    try {
        tempDir = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["mkdtemp"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(__TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["default"].tmpdir(), 'airo-flash-'));
        const sourceFile = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(tempDir, 'sketch.airo');
        const outputDir = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(tempDir, 'output');
        await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["writeFile"])(sourceFile, code, 'utf-8');
        await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["mkdir"])(outputDir, {
            recursive: true
        });
        const pythonPath = process.env.PYTHONPATH || '';
        const envPath = `${AIRO_COMPILER_DIR}${pythonPath ? ':' + pythonPath : ''}`;
        const args = [
            '-m',
            'airo_compiler',
            sourceFile,
            '--target',
            target,
            '--output',
            outputDir
        ];
        let stdout = '';
        let stderr = '';
        let exitCode = 0;
        try {
            const result = await execFileAsync('python3', args, {
                cwd: AIRO_COMPILER_DIR,
                env: {
                    ...process.env,
                    PYTHONPATH: envPath
                },
                timeout: 30000,
                maxBuffer: 1024 * 1024
            });
            stdout = result.stdout;
            stderr = result.stderr;
        } catch (err) {
            const execErr = err;
            stdout = execErr.stdout || '';
            stderr = execErr.stderr || '';
            exitCode = execErr.code ?? 1;
        }
        const errors = [];
        if (exitCode !== 0 && stderr) {
            errors.push(...stderr.split('\n').filter((l)=>l.trim()));
        }
        const generatedFiles = [];
        let generatedCode;
        if (exitCode === 0) {
            const expectedFiles = [
                'main.cpp',
                'pin_map.h',
                'sensor_reader.h',
                'command_executor.h',
                'safety_monitor.h',
                'brain_client.h'
            ];
            for (const filename of expectedFiles){
                try {
                    const filePath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(outputDir, filename);
                    const content = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["readFile"])(filePath, 'utf-8');
                    generatedFiles.push(filename);
                    if (filename === 'main.cpp') {
                        generatedCode = content;
                    }
                } catch  {
                // File doesn't exist, skip
                }
            }
        }
        // Cleanup
        try {
            if (tempDir) await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["rm"])(tempDir, {
                recursive: true,
                force: true
            });
        } catch  {
        // Ignore cleanup errors
        }
        return {
            success: exitCode === 0,
            generatedFiles,
            generatedCode,
            output: stdout + (stderr ? '\n' + stderr : ''),
            errors
        };
    } catch (err) {
        try {
            if (tempDir) await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["rm"])(tempDir, {
                recursive: true,
                force: true
            });
        } catch  {
        // Ignore cleanup errors
        }
        return {
            success: false,
            generatedFiles: [],
            output: `Compilation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            errors: [
                err instanceof Error ? err.message : 'Unknown error'
            ]
        };
    }
}
async function POST(request) {
    const steps = [];
    try {
        const body = await request.json();
        const { code, target = 'esp32', port = 'auto' } = body;
        if (!code || typeof code !== 'string') {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                success: false,
                output: 'Error: No code provided',
                steps: [
                    {
                        name: 'Validation',
                        status: 'error',
                        message: 'No code provided for flashing'
                    }
                ],
                esptoolAvailable: false
            }, {
                status: 400
            });
        }
        // ── Step 1: Compile the .airo code directly ─────────────────
        steps.push({
            name: 'Compile .airo → C++',
            status: 'running',
            message: 'Compiling .airo source code...'
        });
        const compileResult = await compileAiroCode(code, target);
        if (compileResult.success) {
            steps[0] = {
                name: 'Compile .airo → C++',
                status: 'success',
                message: `Compilation successful. Generated ${compileResult.generatedFiles.length} file(s): ${compileResult.generatedFiles.join(', ')}`,
                details: compileResult.output.split('\n').filter((l)=>l.includes('Generated:') || l.includes('Target:')).join('\n')
            };
        } else {
            steps[0] = {
                name: 'Compile .airo → C++',
                status: 'error',
                message: `Compilation failed: ${compileResult.errors.join('; ') || 'Unknown error'}`,
                details: compileResult.output
            };
        }
        // If compilation failed, stop here
        if (!compileResult.success) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                success: false,
                output: compileResult.output,
                steps,
                esptoolAvailable: false,
                compileResult: {
                    success: false,
                    generatedFiles: []
                }
            });
        }
        // ── Step 2: Detect esptool ──────────────────────────────────
        steps.push({
            name: 'Detect esptool',
            status: 'running',
            message: 'Checking for esptool...'
        });
        const esptool = await checkEsptool();
        if (esptool.available) {
            steps[1] = {
                name: 'Detect esptool',
                status: 'success',
                message: `esptool found: ${esptool.path}${esptool.version ? ` (${esptool.version})` : ''}`,
                details: esptool.version || undefined
            };
        } else {
            steps[1] = {
                name: 'Detect esptool',
                status: 'error',
                message: 'esptool not found. Install it with: pip install esptool',
                details: 'Checked: which esptool.py, which esptool, python3 -m esptool --version'
            };
        }
        // ── Step 3: Detect serial ports ─────────────────────────────
        steps.push({
            name: 'Detect serial port',
            status: 'running',
            message: 'Scanning for serial ports...'
        });
        const detectedPorts = await detectPorts();
        const effectivePort = port === 'auto' ? detectedPorts[0] || '/dev/ttyUSB0' : port;
        if (detectedPorts.length > 0) {
            steps[2] = {
                name: 'Detect serial port',
                status: 'success',
                message: `Found ${detectedPorts.length} port(s): ${detectedPorts.join(', ')}. Using: ${effectivePort}`,
                details: detectedPorts.join('\n')
            };
        } else {
            steps[2] = {
                name: 'Detect serial port',
                status: 'warning',
                message: `No serial ports detected. Will use: ${effectivePort}`,
                details: 'Make sure your ESP32 is connected via USB. Check that the appropriate drivers are installed.'
            };
        }
        // ── Step 4: Build firmware (would need Arduino CLI / PlatformIO) ──
        steps.push({
            name: 'Build C++ firmware',
            status: 'warning',
            message: 'Firmware building requires Arduino CLI or PlatformIO, which is not available in the web IDE. ' + 'The generated C++ files can be compiled locally.',
            details: 'To build the firmware locally:\n' + '1. Install Arduino CLI or PlatformIO\n' + '2. Copy the generated files to a sketch directory\n' + `3. Compile for ${target}\n` + '4. Flash using esptool'
        });
        // ── Step 5: Construct esptool flash command ─────────────────
        const chip = target === 'esp32' ? 'esp32' : target;
        const esptoolCmd = esptool.available ? `${esptool.path} --chip ${chip} --port ${effectivePort} --baud 921600 write_flash -z 0x10000 firmware.bin` : `esptool.py --chip ${chip} --port ${effectivePort} --baud 921600 write_flash -z 0x10000 firmware.bin`;
        if (esptool.available) {
            steps.push({
                name: 'Flash firmware',
                status: 'warning',
                message: 'esptool is available but flashing requires a compiled .bin firmware file. ' + 'The C++ source files need to be compiled with Arduino CLI/PlatformIO first.',
                details: `Command that would be run:\n${esptoolCmd}`
            });
        } else {
            steps.push({
                name: 'Flash firmware',
                status: 'error',
                message: 'Cannot flash: esptool is not installed and no firmware binary is available.',
                details: 'To enable flashing:\n' + '1. Install esptool: pip install esptool\n' + '2. Install Arduino CLI or PlatformIO for C++ compilation\n' + `3. Flash command: ${esptoolCmd}`
            });
        }
        // Build the full output message
        const outputLines = steps.map((step)=>`[${step.status.toUpperCase()}] ${step.name}: ${step.message}`);
        const overallSuccess = compileResult.success;
        const canFlash = compileResult.success && esptool.available;
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: overallSuccess,
            output: outputLines.join('\n'),
            steps,
            esptoolCommand: esptoolCmd,
            esptoolAvailable: esptool.available,
            compileResult: {
                success: compileResult.success,
                generatedFiles: compileResult.generatedFiles,
                generatedCode: compileResult.generatedCode
            },
            port: effectivePort,
            canFlash
        });
    } catch (error) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: false,
            output: `Flash pipeline error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            steps: [
                ...steps,
                {
                    name: 'Error',
                    status: 'error',
                    message: error instanceof Error ? error.message : 'Unknown error'
                }
            ],
            esptoolAvailable: false
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__12d4ahx._.js.map