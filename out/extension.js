"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// src/extension.ts
const vscode = require("vscode");
const sidebarProvider_1 = require("./sidebarProvider");
function activate(context) {
    console.log('Private Extensions Manager is now active!');
    // Register the webview provider
    const sidebarProvider = new sidebarProvider_1.PrivateExtensionsSidebarProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(sidebarProvider_1.PrivateExtensionsSidebarProvider.viewType, sidebarProvider));
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.refresh', () => {
        sidebarProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.addItem', () => {
        sidebarProvider.addItem();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('privateExtensionsSidebar.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'privateExtensionsSidebar');
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map