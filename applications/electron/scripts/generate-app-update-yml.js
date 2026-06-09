#!/usr/bin/env node

/********************************************************************************
 * Copyright (C) 2026 STMicroelectronics and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

// Generates app-update.yml for the Windows auto-updater.
//
// The normal electron-builder flow generates this file during afterPack, but
// only when the target is "nsis" or "appx". The Windows CI build splits
// packaging into two steps:
//   1. `electron-builder --dir` (target = "dir") → app-update.yml is skipped
//   2. `electron-builder --prepackaged` → afterPack does not run
//
// This script bridges that gap by writing the file before step 2.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const electronDir = path.resolve(__dirname, '..');
const pkg = require(path.join(electronDir, 'package.json'));
const builderConfig = yaml.load(fs.readFileSync(path.join(electronDir, 'electron-builder.yml'), 'utf8'));

// BUG FIX: The publish config is at the ROOT level of electron-builder.yml,
// NOT under builderConfig.win.publish. The old code read builderConfig.win.publish
// which was undefined, causing the script to crash.
// Priority: win.publish > root publish
const winPublish = (builderConfig.win && builderConfig.win.publish)
    ? builderConfig.win.publish
    : builderConfig.publish;
const version = pkg.version;

if (!winPublish) {
    console.error('ERROR: No publish configuration found in electron-builder.yml');
    console.error('Expected either "publish" at root or "win.publish" section.');
    process.exit(1);
}

// Expand ${version} macro in the URL, matching electron-builder's macro expansion
const url = (winPublish.url || '').replace('${version}', version);

const appUpdateYml = {
    provider: winPublish.provider || 'github',
    ...(url && { url }),
    ...(winPublish.owner && { owner: winPublish.owner }),
    ...(winPublish.repo && { repo: winPublish.repo }),
    ...(winPublish.useMultipleRangeRequest !== undefined && { useMultipleRangeRequest: winPublish.useMultipleRangeRequest }),
    updaterCacheDirName: `${pkg.name}-updater`
};

// Ensure the output directory exists
const outDir = path.join(electronDir, 'dist', 'win-unpacked', 'resources');
if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

const outPath = path.join(outDir, 'app-update.yml');
fs.writeFileSync(outPath, yaml.dump(appUpdateYml, { lineWidth: -1 }));
console.log(`Generated ${outPath}`);
console.log(fs.readFileSync(outPath, 'utf8'));
