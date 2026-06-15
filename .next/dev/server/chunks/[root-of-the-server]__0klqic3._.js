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
"[project]/src/app/api/serial/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET,
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
;
// ESP32 common vendor IDs
const ESP32_VENDOR_IDS = {
    '10c4': 'Silicon Labs (CP210x)',
    '1a86': 'WCH (CH340)',
    '0403': 'FTDI',
    '303a': 'Espressif (ESP32 native USB)',
    '2341': 'Arduino'
};
async function tryListPorts() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const serialport = await import(/* webpackIgnore: true */ 'serialport').catch(()=>null);
        const SerialPort = serialport ? serialport.SerialPort : undefined;
        if (SerialPort && typeof SerialPort.list === 'function') {
            const rawPorts = await SerialPort.list();
            const ports = rawPorts.map((port)=>({
                    path: port.path || '',
                    manufacturer: port.manufacturer || undefined,
                    vendorId: port.vendorId || undefined,
                    productId: port.productId || undefined,
                    serialNumber: port.serialNumber || undefined,
                    pnpId: port.pnpId || undefined,
                    isEsp32: isEsp32Port(port),
                    chipType: identifyChipType(port)
                }));
            return {
                ports,
                available: true
            };
        }
        return {
            ports: [],
            available: false,
            error: 'SerialPort.list not available'
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
            ports: [],
            available: false,
            error: message
        };
    }
}
function isEsp32Port(port) {
    const vendorId = (port.vendorId || '').toLowerCase().replace(/^0x/, '');
    return Object.keys(ESP32_VENDOR_IDS).includes(vendorId);
}
function identifyChipType(port) {
    const vendorId = (port.vendorId || '').toLowerCase().replace(/^0x/, '');
    if (vendorId === '10c4') return 'CP210x';
    if (vendorId === '1a86') return 'CH340';
    if (vendorId === '0403') return 'FTDI';
    if (vendorId === '303a') return 'ESP32 Native USB';
    if (vendorId === '2341') return 'Arduino';
    return undefined;
}
async function GET() {
    const result = await tryListPorts();
    const response = {
        ports: result.ports,
        serialportAvailable: result.available
    };
    if (!result.available) {
        response.note = 'serialport npm package is not available. Serial port detection is disabled. ' + 'Install it with: npm install serialport. ' + (result.error ? `Error: ${result.error}` : '');
    }
    // If no ports found, provide helpful information
    if (result.available && result.ports.length === 0) {
        response.note = 'No serial ports detected. Make sure your ESP32 is connected via USB ' + 'and the appropriate drivers are installed (CP210x, CH340, or FTDI).';
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json(response);
}
async function POST(request) {
    try {
        const body = await request.json();
        const { action, data, port, baudRate } = body;
        switch(action){
            case 'connect':
                {
                    // In a real desktop app, this would open the serial port
                    // For the web IDE, we simulate the connection
                    const effectiveBaud = baudRate || 115200;
                    const effectivePort = port || '/dev/ttyUSB0';
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                        success: true,
                        message: `Connected to ${effectivePort} at ${effectiveBaud} baud (simulated)`,
                        port: effectivePort,
                        baudRate: effectiveBaud,
                        note: 'Serial connection is simulated in the web IDE. For real serial communication, use the desktop app.'
                    });
                }
            case 'disconnect':
                {
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                        success: true,
                        message: 'Disconnected from serial port'
                    });
                }
            case 'send':
                {
                    if (!data) {
                        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                            success: false,
                            error: 'No data provided to send'
                        }, {
                            status: 400
                        });
                    }
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                        success: true,
                        message: `Sent: ${data} (simulated)`,
                        note: 'Serial data transmission is simulated in the web IDE.'
                    });
                }
            case 'list':
                {
                    // Reuse GET logic for listing ports
                    const listResult = await tryListPorts();
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                        success: true,
                        ports: listResult.ports,
                        serialportAvailable: listResult.available
                    });
                }
            default:
                return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                    success: false,
                    error: `Unknown action: ${action}`
                }, {
                    status: 400
                });
        }
    } catch (error) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: false,
            error: `Serial operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0klqic3._.js.map