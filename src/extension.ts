import * as vscode from 'vscode';
import { PrivateExtensionsSidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log('Private Extensions Manager is now active!');

	// Register the webview provider
	const sidebarProvider = new PrivateExtensionsSidebarProvider(context.extensionUri, context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PrivateExtensionsSidebarProvider.viewType, sidebarProvider)
	);

	// Load extensions immediately at startup
	loadExtensionsAtStartup(sidebarProvider, context);

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.refresh', async () => {
			await sidebarProvider.scanDirectories();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.addItem', async () => {
			await sidebarProvider.addDirectory();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.openSettings', () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'privateExtensionsSidebar');
		})
	);

	// Register additional commands for context menu actions
	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.configureDirectories', async () => {
			const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
			const currentDirs = config.get<string[]>('vsixDirectories', []);

			const result = await vscode.window.showInputBox({
				prompt: 'Enter directory paths separated by commas',
				value: currentDirs.join(', '),
				placeHolder: '~/extensions, /path/to/extensions, C:\\Extensions'
			});

			if (result !== undefined) {
				const newDirs = result.split(',').map(dir => dir.trim()).filter(dir => dir.length > 0);
				await config.update('vsixDirectories', newDirs, vscode.ConfigurationTarget.Global);

				vscode.window.showInformationMessage(
					`Updated VSIX directories. Found ${newDirs.length} director${newDirs.length === 1 ? 'y' : 'ies'}.`
				);

				await sidebarProvider.scanDirectories();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.clearCache', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'This will clear the extension cache and rescan all directories. Continue?',
				{ modal: true },
				'Clear Cache'
			);

			if (confirm === 'Clear Cache') {
				await sidebarProvider.scanDirectories();
				vscode.window.showInformationMessage('Extension cache cleared and directories rescanned.');
			}
		})
	);

	// Show initial setup message if no directories are configured
	const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
	const directories = config.get<string[]>('vsixDirectories', []);

	if (directories.length === 0) {
		vscode.window.showInformationMessage(
			'Welcome to Private Extensions Manager! Configure directories to scan for .vsix files.',
			'Configure Directories',
			'Open Settings'
		).then(selection => {
			if (selection === 'Configure Directories') {
				vscode.commands.executeCommand('privateExtensionsSidebar.configureDirectories');
			} else if (selection === 'Open Settings') {
				vscode.commands.executeCommand('workbench.action.openSettings', 'privateExtensionsSidebar');
			}
		});
	}

	// Dispose the sidebar provider when extension is deactivated
	context.subscriptions.push({
		dispose: () => sidebarProvider.dispose()
	});
}

/**
 * Load extensions at startup without waiting for sidebar activation
 */
async function loadExtensionsAtStartup(sidebarProvider: PrivateExtensionsSidebarProvider, context: vscode.ExtensionContext) {
	try {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const directories = config.get<string[]>('vsixDirectories', []);
		
		// Only scan if directories are configured
		if (directories.length === 0) {
			console.log('Extension: No VSIX directories configured, skipping startup scan');
			return;
		}

		// Check if startup loading is enabled
		const loadAtStartup = config.get<boolean>('loadAtStartup', true);
		if (!loadAtStartup) {
			console.log('Extension: Startup loading disabled, skipping startup scan');
			return;
		}

		// Check if auto-scan is enabled
		const autoScan = config.get<boolean>('autoScan', true);
		if (!autoScan) {
			console.log('Extension: Auto-scan disabled, skipping startup scan');
			return;
		}

		console.log('Extension: Starting extension scan at startup...');
		
		// Add a small delay to ensure everything is properly initialized
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// Show progress notification for startup scan
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Loading private extensions",
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0, message: "Scanning directories..." });
			
			try {
				console.log('Extension: About to call scanDirectoriesInBackground...');
				
				// Add timeout protection
				const scanPromise = sidebarProvider.scanDirectoriesInBackground();
				const timeoutPromise = new Promise<void>((_, reject) => {
					setTimeout(() => reject(new Error('Scan timeout after 30 seconds')), 30000);
				});
				
				await Promise.race([scanPromise, timeoutPromise]);
				
				console.log('Extension: scanDirectoriesInBackground completed successfully');
				progress.report({ increment: 100, message: "Complete" });
				
				// Give a moment for the scan to complete
				await new Promise(resolve => setTimeout(resolve, 100));
				
				// Optional: Show completion message
				const extensionCount = sidebarProvider.getExtensionCount();
				console.log(`Extension: Final extension count: ${extensionCount}`);
				if (extensionCount > 0) {
					console.log(`Extension: Loaded ${extensionCount} private extensions at startup`);
					// Uncomment next line for a notification:
					// vscode.window.showInformationMessage(`Loaded ${extensionCount} private extension${extensionCount === 1 ? '' : 's'}`);
				}
			} catch (error) {
				console.error('Extension: Error during startup extension scan:', error);
				progress.report({ increment: 100, message: "Error occurred" });
				vscode.window.showWarningMessage(`Failed to scan extensions at startup: ${error}`);
			}
		});
		
		console.log('Extension: Startup scan process completed');
		
	} catch (error) {
		console.error('Extension: Error in loadExtensionsAtStartup:', error);
	}
}

export function deactivate() { }
