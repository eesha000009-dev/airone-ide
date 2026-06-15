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
"[project]/src/app/api/compile/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
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
async function POST(request) {
    let tempDir = null;
    try {
        const body = await request.json();
        const { code, target = 'esp32', brainUrl } = body;
        if (!code || typeof code !== 'string') {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                success: false,
                output: 'Error: No code provided',
                errors: [
                    {
                        line: 0,
                        column: 0,
                        message: 'No code provided',
                        severity: 'error'
                    }
                ],
                generatedFiles: {}
            }, {
                status: 400
            });
        }
        // Create temp directory for the .airo source file and output
        tempDir = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["mkdtemp"])(__TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(__TURBOPACK__imported__module__$5b$externals$5d2f$os__$5b$external$5d$__$28$os$2c$__cjs$29$__["default"].tmpdir(), 'airo-compile-'));
        const sourceFile = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(tempDir, 'sketch.airo');
        const outputDir = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(tempDir, 'output');
        // Write the .airo source to temp file
        await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["writeFile"])(sourceFile, code, 'utf-8');
        // Ensure output directory exists
        await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["mkdir"])(outputDir, {
            recursive: true
        });
        // Build the compiler command
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
        // Add brain URL if provided (as WiFi/brain config)
        if (brainUrl) {
        // Future: pass brain URL to compiler if it supports it
        }
        // Run the airo-compiler
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
            // If the process was killed (timeout), report that
            if (execErr.killed) {
                return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                    success: false,
                    output: `Compilation timed out after 30 seconds\n${stdout}\n${stderr}`,
                    errors: [
                        {
                            line: 0,
                            column: 0,
                            message: 'Compilation timed out',
                            severity: 'error'
                        }
                    ],
                    generatedFiles: {}
                }, {
                    status: 500
                });
            }
        }
        // Parse errors from stderr
        const errors = [];
        const errorPatterns = [
            /LEX ERROR: (.+)/g,
            /PARSE ERROR: (.+)/g,
            /SAFETY ERRORS?:\n([\s\S]*?)(?:\n\n|\n[A-Z]|\Z)/g
        ];
        // Extract line/column info from error messages if available
        const errorLines = stderr.split('\n').filter((l)=>l.trim());
        for (const line of errorLines){
            // Try to match patterns like "Line X, Column Y: message" or "LEX ERROR: message"
            const lineColMatch = line.match(/Line\s+(\d+),?\s+Column\s+(\d+):\s*(.+)/i);
            const lexErrMatch = line.match(/LEX ERROR:\s*(.+)/);
            const parseErrMatch = line.match(/PARSE ERROR:\s*(.+)/);
            const safetyErrMatch = line.match(/SAFETY\s+ERROR:\s*(.+)/);
            const genericErrMatch = line.match(/Error:\s*(.+)/);
            if (lineColMatch) {
                errors.push({
                    line: parseInt(lineColMatch[1], 10),
                    column: parseInt(lineColMatch[2], 10),
                    message: lineColMatch[3],
                    severity: 'error'
                });
            } else if (lexErrMatch) {
                errors.push({
                    line: 0,
                    column: 0,
                    message: lexErrMatch[1],
                    severity: 'error'
                });
            } else if (parseErrMatch) {
                errors.push({
                    line: 0,
                    column: 0,
                    message: parseErrMatch[1],
                    severity: 'error'
                });
            } else if (safetyErrMatch) {
                errors.push({
                    line: 0,
                    column: 0,
                    message: safetyErrMatch[1],
                    severity: 'error'
                });
            } else if (genericErrMatch && !line.includes('Required libraries')) {
                errors.push({
                    line: 0,
                    column: 0,
                    message: genericErrMatch[1],
                    severity: 'error'
                });
            }
        }
        // Also add warnings from stderr
        const warnLines = stderr.split('\n');
        for (const line of warnLines){
            const warnMatch = line.match(/WARN:\s*(.+)/);
            if (warnMatch) {
                errors.push({
                    line: 0,
                    column: 0,
                    message: warnMatch[1],
                    severity: 'warning'
                });
            }
        }
        const combinedOutput = stdout + (stderr ? '\n' + stderr : '');
        // Read generated files
        const generatedFiles = {};
        const expectedFiles = [
            'main.cpp',
            'pin_map.h',
            'sensor_reader.h',
            'command_executor.h',
            'safety_monitor.h',
            'brain_client.h'
        ];
        if (exitCode === 0) {
            for (const filename of expectedFiles){
                try {
                    const filePath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(outputDir, filename);
                    const content = await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["readFile"])(filePath, 'utf-8');
                    generatedFiles[filename] = content;
                } catch  {
                // File might not exist for certain targets, skip silently
                }
            }
        }
        // Clean up temp files
        try {
            if (tempDir) {
                await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["rm"])(tempDir, {
                    recursive: true,
                    force: true
                });
            }
        } catch  {
        // Ignore cleanup errors
        }
        const success = exitCode === 0;
        const response = {
            success,
            output: combinedOutput.trim(),
            errors,
            generatedFiles,
            generatedCode: generatedFiles['main.cpp'] || undefined
        };
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(response, {
            status: success ? 200 : 422
        });
    } catch (error) {
        // Clean up temp files on unexpected error
        try {
            if (tempDir) {
                await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$fs$2f$promises__$5b$external$5d$__$28$fs$2f$promises$2c$__cjs$29$__["rm"])(tempDir, {
                    recursive: true,
                    force: true
                });
            }
        } catch  {
        // Ignore cleanup errors
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: false,
            output: `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            errors: [
                {
                    line: 0,
                    column: 0,
                    message: error instanceof Error ? error.message : 'Internal compilation error',
                    severity: 'error'
                }
            ],
            generatedFiles: {}
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__03iyi95._.js.map