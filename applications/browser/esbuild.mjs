/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';

import esbuild from 'esbuild';

// Native Node.js modules that cannot be bundled by esbuild.
// serialport is a native addon (C++ binding) used by the Airone backend for
// serial port communication with ESP32 boards. It is dynamically require()'d
// with try/catch fallback, so marking it external is safe.
const NATIVE_EXTERNALS = [
    'serialport',
    '@serialport/parser-readline',
    '@serialport/stream',
    '@serialport/bindings-cpp',
];

// Add native modules as external to the node bundle so esbuild doesn't
// attempt to resolve and bundle them.
if (!nodeOptions.external) {
    nodeOptions.external = [];
}
if (Array.isArray(nodeOptions.external)) {
    for (const ext of NATIVE_EXTERNALS) {
        if (!nodeOptions.external.includes(ext)) {
            nodeOptions.external.push(ext);
        }
    }
}

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);


if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}
