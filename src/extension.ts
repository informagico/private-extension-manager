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

	// Register existing commands
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

	// Register new OpenVSX-related commands
	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.clearRemoteCache', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'This will clear the remote extension cache and downloaded files. Continue?',
				{ modal: true },
				'Clear Cache'
			);

			if (confirm === 'Clear Cache') {
				await sidebarProvider.clearRemoteCache();
				vscode.window.showInformationMessage('Remote extension cache cleared successfully.');
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.showPopular', async () => {
			try {
				await sidebarProvider.showPopularExtensions();
			} catch (error) {
				console.error('Error showing popular extensions:', error);
				vscode.window.showErrorMessage(`Failed to load popular extensions: ${error}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.toggleOpenVSX', async () => {
			const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
			const currentValue = config.get<boolean>('enableOpenVSX', true);
			
			await config.update('enableOpenVSX', !currentValue, vscode.ConfigurationTarget.Global);
			
			const status = !currentValue ? 'enabled' : 'disabled';
			vscode.window.showInformationMessage(`OpenVSX integration ${status}`);
			
			// Refresh to apply changes
			await sidebarProvider.scanDirectories();
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
		vscode.commands.registerCommand('privateExtensionsSidebar.configureOpenVSX', async () => {
			const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
			
			// Show quick pick for OpenVSX settings
			const items = [
				{
					label: '$(gear) Enable/Disable OpenVSX',
					description: `Currently ${config.get('enableOpenVSX', true) ? 'enabled' : 'disabled'}`,
					action: 'toggle'
				},
				{
					label: '$(settings-gear) Max Results',
					description: `Currently ${config.get('maxRemoteResults', 50)} results`,
					action: 'maxResults'
				},
				{
					label: '$(clock) Search Timeout',
					description: `Currently ${config.get('openVSXTimeout', 30)} seconds`,
					action: 'timeout'
				},
				{
					label: '$(search) Min Search Length',
					description: `Currently ${config.get('remoteSearchMinLength', 3)} characters`,
					action: 'minLength'
				},
				{
					label: '$(refresh) Cache Duration',
					description: `Currently ${config.get('cacheDuration', 7)} days`,
					action: 'cacheDuration'
				}
			];

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select OpenVSX setting to configure'
			});

			if (!selected) return;

			switch (selected.action) {
				case 'toggle':
					await vscode.commands.executeCommand('privateExtensionsSidebar.toggleOpenVSX');
					break;
				
				case 'maxResults':
					const maxResults = await vscode.window.showInputBox({
						prompt: 'Enter maximum number of remote results (10-200)',
						value: config.get('maxRemoteResults', 50).toString(),
						validateInput: (value) => {
							const num = parseInt(value);
							if (isNaN(num) || num < 10 || num > 200) {
								return 'Please enter a number between 10 and 200';
							}
							return null;
						}
					});
					if (maxResults) {
						await config.update('maxRemoteResults', parseInt(maxResults), vscode.ConfigurationTarget.Global);
						vscode.window.showInformationMessage(`Max remote results set to ${maxResults}`);
					}
					break;

				case 'timeout':
					const timeout = await vscode.window.showInputBox({
						prompt: 'Enter API timeout in seconds (5-120)',
						value: config.get('openVSXTimeout', 30).toString(),
						validateInput: (value) => {
							const num = parseInt(value);
							if (isNaN(num) || num < 5 || num > 120) {
								return 'Please enter a number between 5 and 120';
							}
							return null;
						}
					});
					if (timeout) {
						await config.update('openVSXTimeout', parseInt(timeout), vscode.ConfigurationTarget.Global);
						vscode.window.showInformationMessage(`API timeout set to ${timeout} seconds`);
					}
					break;

				case 'minLength':
					const minLength = await vscode.window.showInputBox({
						prompt: 'Enter minimum search length for remote search (1-10)',
						value: config.get('remoteSearchMinLength', 3).toString(),
						validateInput: (value) => {
							const num = parseInt(value);
							if (isNaN(num) || num < 1 || num > 10) {
								return 'Please enter a number between 1 and 10';
							}
							return null;
						}
					});
					if (minLength) {
						await config.update('remoteSearchMinLength', parseInt(minLength), vscode.ConfigurationTarget.Global);
						vscode.window.showInformationMessage(`Minimum search length set to ${minLength} characters`);
					}
					break;

				case 'cacheDuration':
					const cacheDuration = await vscode.window.showInputBox({
						prompt: 'Enter cache duration in days (1-30)',
						value: config.get('cacheDuration', 7).toString(),
						validateInput: (value) => {
							const num = parseInt(value);
							if (isNaN(num) || num < 1 || num > 30) {
								return 'Please enter a number between 1 and 30';
							}
							return null;
						}
					});
					if (cacheDuration) {
						await config.update('cacheDuration', parseInt(cacheDuration), vscode.ConfigurationTarget.Global);
						vscode.window.showInformationMessage(`Cache duration set to ${cacheDuration} days`);
					}
					break;
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('privateExtensionsSidebar.clearCache', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'This will clear both local and remote extension caches and rescan all directories. Continue?',
				{ modal: true },
				'Clear All Caches'
			);

			if (confirm === 'Clear All Caches') {
				await sidebarProvider.clearAllCaches();
				vscode.window.showInformationMessage('All caches cleared and directories rescanned.');
			}
		})
	);

	// Show initial setup message with enhanced information
	const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
	const directories = config.get<string[]>('vsixDirectories', []);
	const openVSXEnabled = config.get<boolean>('enableOpenVSX', true);

	if (directories.length === 0 && !openVSXEnabled) {
		vscode.window.showInformationMessage(
			'Welcome to Private Extensions Manager! Configure directories or enable OpenVSX to get started.',
			'Configure Directories',
			'Enable OpenVSX',
			'Open Settings'
		).then(selection => {
			if (selection === 'Configure Directories') {
				vscode.commands.executeCommand('privateExtensionsSidebar.configureDirectories');
			} else if (selection === 'Enable OpenVSX') {
				vscode.commands.executeCommand('privateExtensionsSidebar.toggleOpenVSX');
			} else if (selection === 'Open Settings') {
				vscode.commands.executeCommand('workbench.action.openSettings', 'privateExtensionsSidebar');
			}
		});
	} else if (directories.length === 0) {
		vscode.window.showInformationMessage(
			'Configure local directories to scan for .vsix files, or search the OpenVSX registry.',
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

	// Enhanced status bar item for OpenVSX
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = openVSXEnabled ? '$(cloud) OpenVSX' : '$(folder) Local Only';
	statusBarItem.tooltip = openVSXEnabled ? 
		'OpenVSX integration enabled - Click to configure' : 
		'OpenVSX integration disabled - Click to enable';
	statusBarItem.command = 'privateExtensionsSidebar.configureOpenVSX';
	
	// Only show status bar item if the sidebar is visible
	context.subscriptions.push(statusBarItem);
	
	// Listen for configuration changes to update status bar
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('privateExtensionsSidebar.enableOpenVSX')) {
				const newValue = vscode.workspace.getConfiguration('privateExtensionsSidebar').get<boolean>('enableOpenVSX', true);
				statusBarItem.text = newValue ? '$(cloud) OpenVSX' : '$(folder) Local Only';
				statusBarItem.tooltip = newValue ? 
					'OpenVSX integration enabled - Click to configure' : 
					'OpenVSX integration disabled - Click to enable';
			}
		})
	);

	// Show status bar when extension is active
	statusBarItem.show();

	// Dispose the sidebar provider when extension is deactivated
	context.subscriptions.push({
		dispose: () => {
			sidebarProvider.dispose();
			statusBarItem.dispose();
		}
	});
}

/**
 * Enhanced startup loading with OpenVSX support
 */
async function loadExtensionsAtStartup(sidebarProvider: PrivateExtensionsSidebarProvider, context: vscode.ExtensionContext) {
	try {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const directories = config.get<string[]>('vsixDirectories', []);
		const openVSXEnabled = config.get<boolean>('enableOpenVSX', true);
		
		// Skip if both local and remote are disabled
		if (directories.length === 0 && !openVSXEnabled) {
			console.log('Extension: No directories configured and OpenVSX disabled, skipping startup scan');
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

		console.log('Extension: Starting enhanced extension scan at startup...');
		
		// Add a small delay to ensure everything is properly initialized
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// Show progress notification for startup scan
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Loading private extensions",
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0, message: "Initializing..." });
			
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
					// Show notification with OpenVSX info if enabled
					if (openVSXEnabled && directories.length > 0) {
						console.log(`Extension: OpenVSX integration enabled for additional search capabilities`);
					} else if (openVSXEnabled) {
						console.log(`Extension: OpenVSX integration enabled - local directories can be configured later`);
					}
				}
			} catch (error) {
				console.error('Extension: Error during startup extension scan:', error);
				progress.report({ increment: 100, message: "Error occurred" });
				vscode.window.showWarningMessage(`Failed to scan extensions at startup: ${error}`);
			}
		});
		
		console.log('Extension: Enhanced startup scan process completed');
		
	} catch (error) {
		console.error('Extension: Error in loadExtensionsAtStartup:', error);
	}
}

export function deactivate() { }
