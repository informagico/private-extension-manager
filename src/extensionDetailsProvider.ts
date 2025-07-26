import * as vscode from 'vscode';
import { marked } from 'marked';
import { StorageProvider, ExtensionInfo } from './storageProvider';
import { VsixUtils } from './vsixUtils';

export interface ExtensionDetails {
	id: string;
	title: string;
	displayName: string;
	description: string;
	version: string;
	publisher: string;
	author: string;
	icon?: string;
	categories?: string[];
	keywords?: string[];
	filePath: string;
	fileSize: number;
	lastModified: Date;
	readme?: string;
	changelog?: string;
	repository?: string;
	bugs?: string;
	homepage?: string;
	license?: string;
	engines?: { [key: string]: string };
	isInstalled: boolean;
	hasUpdate?: boolean;
}

export class ExtensionDetailsProvider {
	private _activePanels: Map<string, vscode.WebviewPanel> = new Map();

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _storageProvider: StorageProvider
	) { }

	/**
	 * Triggers VS Code extension restart with user-configurable behavior
	 */
	private async triggerExtensionRestart(operation: 'install' | 'update' | 'uninstall', extensionName: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const autoRestart = config.get<boolean>('autoRestartAfterInstall', false);
		const restartMethod = config.get<string>('restartMethod', 'prompt');

		if (autoRestart && restartMethod !== 'prompt') {
			// Automatic restart without prompt
			const action = operation === 'install' ? 'installed' : operation === 'update' ? 'updated' : 'uninstalled';
			
			vscode.window.showInformationMessage(
				`${extensionName} ${action} successfully. Restarting extensions...`
			);
			
			setTimeout(async () => {
				try {
					if (restartMethod === 'extensionHost') {
						await vscode.commands.executeCommand('workbench.action.restartExtensionHost');
						vscode.window.showInformationMessage('Extension host restarted successfully.');
					} else {
						await vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				} catch (error) {
					console.error('Error during automatic restart:', error);
					vscode.window.showWarningMessage(
						'Failed to restart automatically. Please reload the window manually.'
					);
				}
			}, 1000);
		} else {
			// Prompt user for restart method
			const action = operation === 'install' ? 'installed' : operation === 'update' ? 'updated' : 'uninstalled';
			const choice = await vscode.window.showInformationMessage(
				`${extensionName} ${action} successfully. Choose how to apply changes:`,
				'Restart Extensions',
				'Reload Window',
				'Later'
			);

			switch (choice) {
				case 'Restart Extensions':
					try {
						await vscode.commands.executeCommand('workbench.action.restartExtensionHost');
						vscode.window.showInformationMessage('Extension host restarted successfully.');
					} catch (error) {
						console.warn('Extension host restart failed, offering reload option:', error);
						const fallbackChoice = await vscode.window.showWarningMessage(
							'Extension host restart failed. Reload the window instead?',
							'Reload Window',
							'Cancel'
						);
						if (fallbackChoice === 'Reload Window') {
							await vscode.commands.executeCommand('workbench.action.reloadWindow');
						}
					}
					break;
				case 'Reload Window':
					await vscode.commands.executeCommand('workbench.action.reloadWindow');
					break;
				case 'Later':
					vscode.window.showInformationMessage(
						'Extension changes will take effect after the next window reload.',
						'Reload Now'
					).then(choice => {
						if (choice === 'Reload Now') {
							vscode.commands.executeCommand('workbench.action.reloadWindow');
						}
					});
					break;
			}
		}
	}

	public async showExtensionDetails(filePath: string): Promise<void> {
		try {
			const extensionInfo = this._findExtensionByFilePath(filePath);

			if (!extensionInfo) {
				vscode.window.showErrorMessage('Extension not found in cache. Try refreshing the extension list.');
				return;
			}

			// Check if panel already exists for this extension
			const existingPanel = this._activePanels.get(extensionInfo.id);
			if (existingPanel) {
				// Focus the existing panel instead of creating a new one
				existingPanel.reveal(vscode.ViewColumn.One);
				
				// Update the content in case the extension data has changed
				const extensionDetails = this._buildExtensionDetails(extensionInfo);
				existingPanel.webview.html = this._getWebviewContent(extensionDetails, existingPanel.webview);
				return;
			}

			const extensionDetails = this._buildExtensionDetails(extensionInfo);

			const panel = vscode.window.createWebviewPanel(
				'extensionDetails',
				`${extensionDetails.title}`,
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					localResourceRoots: [this._extensionUri],
					retainContextWhenHidden: true
				}
			);

			// Use extension ID as the key (without timestamp)
			this._activePanels.set(extensionInfo.id, panel);

			panel.onDidDispose(() => {
				this._activePanels.delete(extensionInfo.id);
			});

			panel.webview.onDidReceiveMessage(
				message => {
					switch (message.command) {
						case 'openUrl':
							if (message.url) {
								vscode.env.openExternal(vscode.Uri.parse(message.url));
							}
							break;
						case 'installExtension':
							this._handleInstallExtension(extensionInfo, panel);
							break;
						case 'uninstallExtension':
							this._handleUninstallExtension(extensionInfo.id, panel);
							break;
						case 'showError':
							if (message.message) {
								vscode.window.showErrorMessage(message.message);
							}
							break;
					}
				}
			);

			panel.webview.html = this._getWebviewContent(extensionDetails, panel.webview);

		} catch (error) {
			console.error('Error showing extension details:', error);
			vscode.window.showErrorMessage(`Error loading extension details: ${error}`);
		}
	}

	private _findExtensionByFilePath(filePath: string): ExtensionInfo | null {
		const allExtensions = this._storageProvider.searchExtensions('');
		const extension = allExtensions.find(ext => ext.filePath === filePath);
		return extension || null;
	}

	private _buildExtensionDetails(extensionInfo: ExtensionInfo): ExtensionDetails {
		let bugsUrl: string | undefined;
		if (extensionInfo.repository) {
			if (extensionInfo.repository.includes('github.com')) {
				bugsUrl = `${extensionInfo.repository.replace(/\.git$/, '')}/issues`;
			} else if (extensionInfo.repository.includes('gitlab.com')) {
				bugsUrl = `${extensionInfo.repository.replace(/\.git$/, '')}/issues`;
			}
		}

		if (extensionInfo.packageJsonRaw?.bugs) {
			if (typeof extensionInfo.packageJsonRaw.bugs === 'string') {
				bugsUrl = extensionInfo.packageJsonRaw.bugs;
			} else if (extensionInfo.packageJsonRaw.bugs.url) {
				bugsUrl = extensionInfo.packageJsonRaw.bugs.url;
			}
		}

		return {
			id: extensionInfo.id,
			title: extensionInfo.title,
			displayName: extensionInfo.packageJsonRaw?.displayName || extensionInfo.title,
			description: extensionInfo.description,
			version: extensionInfo.version,
			publisher: extensionInfo.publisher,
			author: extensionInfo.author,
			icon: extensionInfo.icon,
			categories: extensionInfo.categories,
			keywords: extensionInfo.keywords,
			filePath: extensionInfo.filePath,
			fileSize: extensionInfo.fileSize,
			lastModified: extensionInfo.lastModified,
			readme: extensionInfo.readme,
			changelog: extensionInfo.changelog,
			repository: extensionInfo.repository,
			bugs: bugsUrl,
			homepage: extensionInfo.homepage,
			license: extensionInfo.license,
			engines: extensionInfo.engines,
			isInstalled: extensionInfo.isInstalled,
			hasUpdate: extensionInfo.hasUpdate
		};
	}

	private async _handleInstallExtension(extensionInfo: ExtensionInfo, panel: vscode.WebviewPanel): Promise<void> {
		try {
			// Send immediate success feedback to update UI
			panel.webview.postMessage({
				command: 'installComplete',
				success: true
			});

			// Wait a moment for UI to update
			await new Promise(resolve => setTimeout(resolve, 500));

			// Perform the installation (which will trigger restart)
			const success = await this._storageProvider.installExtension(extensionInfo);
			
			if (!success) {
				// If installation failed, revert the UI
				panel.webview.postMessage({
					command: 'installComplete',
					success: false,
					error: 'Installation failed'
				});
			}

			// Note: StorageProvider.installExtension handles the restart, so the window
			// will reload/restart before we can update the panel content
		} catch (error) {
			console.error('Error installing extension from details view:', error);
			panel.webview.postMessage({
				command: 'installComplete',
				success: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private async _handleUninstallExtension(extensionId: string, panel: vscode.WebviewPanel): Promise<void> {
		try {
			// Send immediate success feedback to update UI
			panel.webview.postMessage({
				command: 'uninstallComplete',
				success: true
			});

			// Wait a moment for UI to update
			await new Promise(resolve => setTimeout(resolve, 500));

			// Perform the uninstallation (which will trigger restart)
			const success = await this._storageProvider.uninstallExtension(extensionId);
			
			if (!success) {
				// If uninstallation failed, revert the UI
				panel.webview.postMessage({
					command: 'uninstallComplete',
					success: false,
					error: 'Uninstallation failed'
				});
			}

			// Note: StorageProvider.uninstallExtension handles the restart, so the window
			// will reload/restart before we can update the panel content
		} catch (error) {
			console.error('Error uninstalling extension from details view:', error);
			panel.webview.postMessage({
				command: 'uninstallComplete',
				success: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Update all open panels when extension data changes
	 */
	public updateOpenPanels(): void {
		this._activePanels.forEach((panel, extensionId) => {
			const extensionInfo = this._storageProvider.getExtensionById(extensionId);
			if (extensionInfo) {
				const extensionDetails = this._buildExtensionDetails(extensionInfo);
				panel.webview.html = this._getWebviewContent(extensionDetails, panel.webview);
			}
		});
	}

	/**
	 * Close panel for a specific extension
	 */
	public closePanelForExtension(extensionId: string): void {
		const panel = this._activePanels.get(extensionId);
		if (panel) {
			panel.dispose();
		}
	}

	/**
	 * Get list of currently open extension IDs
	 */
	public getOpenExtensions(): string[] {
		return Array.from(this._activePanels.keys());
	}

	private _getWebviewContent(details: ExtensionDetails, webview: vscode.Webview): string {
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleDetailsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'extension-details.css'));

		const nonce = this._getNonce();

		let readmeHtml = details.readme ?
			marked.parse(details.readme) :
			'<p>No README.md found in this extension.</p>';

		let changelogHtml = details.changelog ?
			marked.parse(details.changelog) :
			'<p>No CHANGELOG.md found in this extension.</p>';

		const getStatusDisplay = () => {
			if (!details.isInstalled) {
				return {
					badge: '<span class="status-badge not-installed">Not Installed</span>',
					buttons: `
						<button class="install-button" id="install-btn">
							<span class="codicon codicon-cloud-download"></span>
							Install
						</button>
					`
				};
			} else if (details.hasUpdate) {
				return {
					badge: '<span class="status-badge installed">Installed</span> <span class="status-badge" style="background-color: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-left: 8px;">Update Available</span>',
					buttons: `
						<button class="install-button update-button" id="update-btn">
							<span class="codicon codicon-arrow-up"></span>
							Update
						</button>
						<button class="uninstall-button" id="uninstall-btn">
							<span class="codicon codicon-trash"></span>
							Uninstall
						</button>
					`
				};
			} else {
				return {
					badge: '<span class="status-badge installed">Installed</span>',
					buttons: `
						<button class="uninstall-button" id="uninstall-btn">
							<span class="codicon codicon-trash"></span>
							Uninstall
						</button>
					`
				};
			}
		};

		const statusDisplay = getStatusDisplay();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleResetUri}" rel="stylesheet">
	<link href="${styleVSCodeUri}" rel="stylesheet">
	<link href="${styleDetailsUri}" rel="stylesheet">
	<title>Extension Details</title>
</head>
<body class="extension-details-container">
	<div class="extension-header">
		<div class="extension-header-content">
			<div class="extension-icon-container">
				${details.icon ? `
					<img src="${details.icon}" class="extension-icon-large" alt="${details.title} icon" />
				` : `
					<div class="icon-placeholder-large">
						<span class="codicon codicon-extensions"></span>
					</div>
				`}
			</div>
			<div class="extension-main-info">
				<h1 class="extension-title">${details.title}</h1>
				<div class="extension-publisher">
					<span class="publisher-name">${details.publisher}</span>
				</div>
				<div class="extension-description">${details.description}</div>
				<div class="extension-actions">
					${statusDisplay.buttons}
					<span class="settings-gear codicon codicon-gear" id="settings-gear"></span>
				</div>
			</div>
		</div>
	</div>

	<div class="content-area">
		<div class="main-content">
			<div class="tabs-container">
				<div class="tabs-header">
					<button class="tab-button active" data-tab="details">Details</button>
					<button class="tab-button" data-tab="features">Features</button>
				</div>
				
				<div class="tab-content active" id="details-tab">
					<div class="markdown-content">
						${readmeHtml}
					</div>
				</div>
				
				<div class="tab-content" id="features-tab">
					<div class="markdown-content">
						${changelogHtml}
						
						${details.keywords && details.keywords.length > 0 ? `
						<div class="features-section">
							<h2>Keywords</h2>
							<p>${details.keywords.join(', ')}</p>
						</div>
						` : ''}

						<div class="troubleshooting-section">
							<h2>Technical Information</h2>
							
							${details.engines && Object.keys(details.engines).length > 0 ? `
							<div class="troubleshooting-item">
								<div class="troubleshooting-title">Engine Requirements:</div>
								<div class="troubleshooting-content">
									${Object.entries(details.engines).map(([engine, version]) =>
			`<code>${engine}: ${version}</code>`
		).join('<br>')}
								</div>
							</div>
							` : ''}
							
							<div class="troubleshooting-item">
								<div class="troubleshooting-title">Installation:</div>
								<div class="troubleshooting-content">
									This extension is installed from a local VSIX file. Updates must be done manually by replacing the VSIX file and reinstalling.
								</div>
							</div>
							
							<div class="troubleshooting-item">
								<div class="troubleshooting-title">Extension Restart:</div>
								<div class="troubleshooting-content">
									After installing, updating, or uninstalling, VS Code will prompt to restart extensions or reload the window for changes to take effect.
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="extension-sidebar">
			<div class="sidebar-section">
				<div class="sidebar-content">
					<div class="metadata-item">
						<span class="metadata-label">Identifier</span><br>
						${details.id}
					</div>
					<div class="metadata-item">
						<span class="metadata-label">Version</span><br>
						${details.version}
					</div>
					<div class="metadata-item">
						<span class="metadata-label">Published</span><br>
						${details.lastModified.toLocaleDateString()}
					</div>
					<div class="metadata-item">
						<span class="metadata-label">Status</span><br>
						${statusDisplay.badge}
					</div>
				</div>
			</div>

			${details.categories && details.categories.length > 0 ? `
			<div class="sidebar-section">
				<div class="sidebar-title">Categories</div>
				<div class="sidebar-content">
					<div class="categories-list">
						${details.categories.map(cat => `<div class="category-tag">${cat}</div>`).join('')}
					</div>
				</div>
			</div>
			` : ''}

			<div class="sidebar-section">
				<div class="sidebar-title">Resources</div>
				<div class="sidebar-content">
					<div class="resources-list">
						${details.homepage ? `<a href="${details.homepage}" class="resource-link">Homepage</a>` : ''}
						${details.repository ? `<a href="${details.repository}" class="resource-link">Repository</a>` : ''}
						${details.bugs ? `<a href="${details.bugs}" class="resource-link">Report Issues</a>` : ''}
						${details.license ? `<div class="resource-item">License: ${details.license}</div>` : ''}
					</div>
				</div>
			</div>

			<div class="sidebar-section">
				<div class="sidebar-title">File Information</div>
				<div class="sidebar-content">
					<div class="metadata-item">
						<span class="metadata-label">File Size</span><br>
						${VsixUtils.formatFileSize(details.fileSize)}
					</div>
					<div class="metadata-item">
						<span class="metadata-label">File Path</span><br>
						<span class="file-path" title="${details.filePath}">${this._shortenPath(details.filePath)}</span>
					</div>
					${details.engines?.vscode ? `
					<div class="metadata-item">
						<span class="metadata-label">VS Code Engine</span><br>
						${details.engines.vscode}
					</div>
					` : ''}
				</div>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		
		document.querySelectorAll('.tab-button').forEach(button => {
			button.addEventListener('click', () => {
				const tabName = button.dataset.tab;
				
				document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
				button.classList.add('active');
				
				document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
				document.getElementById(tabName + '-tab').classList.add('active');
			});
		});
		
		function openUrl(url) {
			if (url === '#') return;
			try {
				vscode.postMessage({
					command: 'openUrl',
					url: url
				});
			} catch (error) {
				console.error('Error opening URL:', error);
			}
		}
		
		function installExtension() {
			const button = document.getElementById('install-btn');
			if (button) {
				button.innerHTML = '<span class="codicon codicon-sync spin"></span> Installing...';
				button.disabled = true;
			}
			
			vscode.postMessage({
				command: 'installExtension'
			});
		}

		function updateExtension() {
			const button = document.getElementById('update-btn');
			if (button) {
				button.innerHTML = '<span class="codicon codicon-sync spin"></span> Updating...';
				button.disabled = true;
			}
			
			vscode.postMessage({
				command: 'installExtension'
			});
		}
		
		function uninstallExtension() {
			const button = document.getElementById('uninstall-btn');
			if (button) {
				button.innerHTML = '<span class="codicon codicon-sync spin"></span> Uninstalling...';
				button.disabled = true;
			}
			
			vscode.postMessage({
				command: 'uninstallExtension'
			});
		}
		
		document.addEventListener('DOMContentLoaded', () => {
			const installBtn = document.getElementById('install-btn');
			if (installBtn) {
				installBtn.addEventListener('click', installExtension);
			}
			
			const updateBtn = document.getElementById('update-btn');
			if (updateBtn) {
				updateBtn.addEventListener('click', updateExtension);
			}
			
			const uninstallBtn = document.getElementById('uninstall-btn');
			if (uninstallBtn) {
				uninstallBtn.addEventListener('click', uninstallExtension);
			}
			
			const settingsGear = document.getElementById('settings-gear');
			if (settingsGear) {
				settingsGear.addEventListener('click', () => {
					vscode.postMessage({
						command: 'openUrl',
						url: 'command:workbench.action.openSettings?%5B%22privateExtensionsSidebar%22%5D'
					});
				});
			}
		});
		
		window.addEventListener('message', event => {
			const message = event.data;
			
			switch (message.command) {
				case 'installComplete':
					const installBtn = document.getElementById('install-btn');
					const updateBtn = document.getElementById('update-btn');
					
					if (installBtn) {
						if (message.success) {
							installBtn.innerHTML = '<span class="codicon codicon-check"></span> Installed!';
							installBtn.style.backgroundColor = 'var(--vscode-charts-green)';
							installBtn.disabled = true;
							
							// Show message about restart
							const restartMsg = document.createElement('div');
							restartMsg.style.cssText = 'margin-top: 8px; padding: 8px; background-color: var(--vscode-textBlockQuote-background); border-radius: 4px; font-size: 12px;';
							restartMsg.innerHTML = '<span class="codicon codicon-info"></span> Extension will be activated after restart.';
							installBtn.parentNode.appendChild(restartMsg);
						} else {
							installBtn.innerHTML = '<span class="codicon codicon-cloud-download"></span> Install';
							installBtn.disabled = false;
							if (message.error) {
								vscode.postMessage({
									command: 'showError',
									message: message.error
								});
							}
						}
					}
					
					if (updateBtn) {
						if (message.success) {
							updateBtn.innerHTML = '<span class="codicon codicon-check"></span> Updated!';
							updateBtn.style.backgroundColor = 'var(--vscode-charts-green)';
							updateBtn.disabled = true;
							
							// Show message about restart
							const restartMsg = document.createElement('div');
							restartMsg.style.cssText = 'margin-top: 8px; padding: 8px; background-color: var(--vscode-textBlockQuote-background); border-radius: 4px; font-size: 12px;';
							restartMsg.innerHTML = '<span class="codicon codicon-info"></span> Extension will be updated after restart.';
							updateBtn.parentNode.appendChild(restartMsg);
						} else {
							updateBtn.innerHTML = '<span class="codicon codicon-arrow-up"></span> Update';
							updateBtn.disabled = false;
							if (message.error) {
								vscode.postMessage({
									command: 'showError',
									message: message.error
								});
							}
						}
					}
					break;
					
				case 'uninstallComplete':
					const uninstallBtn = document.getElementById('uninstall-btn');
					if (uninstallBtn) {
						if (message.success) {
							uninstallBtn.innerHTML = '<span class="codicon codicon-check"></span> Uninstalled!';
							uninstallBtn.style.backgroundColor = 'var(--vscode-charts-green)';
							uninstallBtn.disabled = true;
							
							// Show message about restart
							const restartMsg = document.createElement('div');
							restartMsg.style.cssText = 'margin-top: 8px; padding: 8px; background-color: var(--vscode-textBlockQuote-background); border-radius: 4px; font-size: 12px;';
							restartMsg.innerHTML = '<span class="codicon codicon-info"></span> Extension will be deactivated after restart.';
							uninstallBtn.parentNode.appendChild(restartMsg);
						} else {
							uninstallBtn.innerHTML = '<span class="codicon codicon-trash"></span> Uninstall';
							uninstallBtn.disabled = false;
							if (message.error) {
								vscode.postMessage({
									command: 'showError',
									message: message.error
								});
							}
						}
					}
					break;
			}
		});
		
		document.addEventListener('click', function(e) {
			const link = e.target.closest('a');
			// Exclude resource-link class to prevent double opening
			if (link && !link.classList.contains('resource-link') && link.href && !link.href.startsWith('javascript:') && link.href !== window.location.href + '#') {
				e.preventDefault();
				const href = link.getAttribute('href') || link.href;
				if (href && href !== '#' && !href.startsWith('javascript:')) {
					openUrl(href);
				}
			}
		});
		
		// Handle resource links
		document.querySelectorAll('.resource-link').forEach(link => {
			link.addEventListener('click', function(e) {
				e.preventDefault();
				const href = this.getAttribute('href');
				if (href) {
					openUrl(href);
				}
			});
		});
	</script>
</body>
</html>`;
	}

	private _shortenPath(filePath: string): string {
		const maxLength = 50;
		if (filePath.length <= maxLength) {
			return filePath;
		}

		const fileName = filePath.split(/[/\\]/).pop() || '';
		const directory = filePath.substring(0, filePath.length - fileName.length);

		if (directory.length + fileName.length <= maxLength) {
			return filePath;
		}

		const availableLength = maxLength - fileName.length - 3;
		const shortenedDir = directory.substring(0, availableLength);

		return `${shortenedDir}...${fileName}`;
	}

	private _getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}

	public dispose(): void {
		this._activePanels.forEach(panel => panel.dispose());
		this._activePanels.clear();
	}
}
