/**
 * Airo Language Extension for VS Code / Theia
 *
 * Provides:
 * - Syntax highlighting via TextMate grammar
 * - Code snippets for common .airo patterns
 * - Language configuration (bracket matching, comments, etc.)
 * - Commands for verify, upload, new sketch
 */

const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('Airo Language extension activated');

    // Register commands
    const verifyCmd = vscode.commands.registerCommand('airo.verify', () => {
        vscode.commands.executeCommand('airo.verify.fromSidebar');
        vscode.window.showInformationMessage('Airo: Verifying sketch...');
    });

    const uploadCmd = vscode.commands.registerCommand('airo.upload', () => {
        vscode.commands.executeCommand('airo.upload.fromSidebar');
        vscode.window.showInformationMessage('Airo: Uploading to board...');
    });

    const newSketchCmd = vscode.commands.registerCommand('airo.newSketch', () => {
        vscode.commands.executeCommand('airo.newSketch.fromSidebar');
    });

    context.subscriptions.push(verifyCmd, uploadCmd, newSketchCmd);

    // Show activation message
    vscode.window.setStatusBarMessage('Airo Language Ready', 3000);
}

function deactivate() {
    console.log('Airo Language extension deactivated');
}

module.exports = {
    activate,
    deactivate
};
