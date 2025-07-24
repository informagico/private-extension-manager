"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
// src/extension.ts
const vscode = require("vscode");
const sidebarProvider_1 = require("./sidebarProvider");
function activate(context) {
    console.log('Private Extensions Manager is now active!');
    // Register the webview provider
    const sidebarProvider = new sidebarProvider_1.PrivateExtensionsSidebarProvider(context.extensionUri, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(sidebarProvider_1.PrivateExtensionsSidebarProvider.viewType, sidebarProvider));
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.refresh', async () => {
        await sidebarProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.addItem', async () => {
        await sidebarProvider.addDirectory();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.scanDirectories', async () => {
        await sidebarProvider.scanDirectories();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'privateExtensionsSidebar');
    }));
    // Register additional commands for context menu actions
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.configureDirectories', async () => {
        const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
        const currentDirs = config.get('vsixDirectories', []);
        const result = await vscode.window.showInputBox({
            prompt: 'Enter directory paths separated by commas',
            value: currentDirs.join(', '),
            placeHolder: '~/extensions, /path/to/extensions, C:\\Extensions'
        });
        if (result !== undefined) {
            const newDirs = result.split(',').map(dir => dir.trim()).filter(dir => dir.length > 0);
            await config.update('vsixDirectories', newDirs, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Updated VSIX directories. Found ${newDirs.length} director${newDirs.length === 1 ? 'y' : 'ies'}.`);
            await sidebarProvider.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.clearCache', async () => {
        const confirm = await vscode.window.showWarningMessage('This will clear the extension cache and rescan all directories. Continue?', { modal: true }, 'Clear Cache');
        if (confirm === 'Clear Cache') {
            await sidebarProvider.scanDirectories();
            vscode.window.showInformationMessage('Extension cache cleared and directories rescanned.');
        }
    }));
    // Show initial setup message if no directories are configured
    const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
    const directories = config.get('vsixDirectories', []);
    if (directories.length === 0) {
        vscode.window.showInformationMessage('Welcome to Private Extensions Manager! Configure directories to scan for .vsix files.', 'Configure Directories', 'Open Settings').then(selection => {
            if (selection === 'Configure Directories') {
                vscode.commands.executeCommand('privateExtensionsSidebar.configureDirectories');
            }
            else if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'privateExtensionsSidebar');
            }
        });
    }
    // Dispose the sidebar provider when extension is deactivated
    context.subscriptions.push({
        dispose: () => sidebarProvider.dispose()
    });
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map