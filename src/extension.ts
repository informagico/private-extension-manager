// src/extension.ts
import * as vscode from 'vscode';
import { PrivateExtensionsSidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Private Extensions Manager is now active!');

	// Register the webview provider
	const sidebarProvider = new PrivateExtensionsSidebarProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PrivateExtensionsSidebarProvider.viewType, sidebarProvider)
	);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.refresh', () => {
			sidebarProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.addItem', () => {
			sidebarProvider.addItem();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'privateExtensionsSidebar');
		})
	);
}

export function deactivate() { }
