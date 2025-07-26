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
}

export class ExtensionDetailsProvider {
	private _panel?: vscode.WebviewPanel;
	private _extensionDetails?: ExtensionDetails;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _storageProvider: StorageProvider
	) { }

	public async showExtensionDetails(filePath: string): Promise<void> {
		try {
			// Get the already-parsed extension data instead of parsing again
			const extensionInfo = this._findExtensionByFilePath(filePath);

			if (!extensionInfo) {
				vscode.window.showErrorMessage('Extension not found in cache. Try refreshing the extension list.');
				return;
			}

			// Build extension details from cached data
			this._extensionDetails = this._buildExtensionDetails(extensionInfo);

			// Create or show the webview panel
			if (this._panel) {
				this._panel.reveal(vscode.ViewColumn.One);
			} else {
				this._panel = vscode.window.createWebviewPanel(
					'extensionDetails',
					`${this._extensionDetails.title}`,
					vscode.ViewColumn.One,
					{
						enableScripts: true,
						localResourceRoots: [this._extensionUri],
						retainContextWhenHidden: true
					}
				);

				this._panel.onDidDispose(() => {
					this._panel = undefined;
				});

				this._panel.webview.onDidReceiveMessage(
					message => {
						console.log('Received message in extension:', message);
						switch (message.command) {
							case 'openUrl':
								if (message.url) {
									console.log('Opening external URL:', message.url);
									vscode.env.openExternal(vscode.Uri.parse(message.url));
								} else {
									console.error('No URL provided in openUrl message');
								}
								break;
							case 'installExtension':
								this._handleInstallExtension(extensionInfo);
								break;
							case 'uninstallExtension':
								this._handleUninstallExtension(extensionInfo.id);
								break;
							default:
								console.log('Unknown message command:', message.command);
						}
					}
				);
			}

			// Update the webview content
			this._panel.webview.html = this._getWebviewContent();

		} catch (error) {
			console.error('Error showing extension details:', error);
			vscode.window.showErrorMessage(`Error loading extension details: ${error}`);
		}
	}

	/**
	 * Find extension by file path in the storage provider cache
	 */
	private _findExtensionByFilePath(filePath: string): ExtensionInfo | null {
		// Search through all cached extensions to find one with matching file path
		const allExtensions = this._storageProvider.searchExtensions(''); // Get all extensions

		const extension = allExtensions.find(ext => ext.filePath === filePath);
		return extension || null;
	}

	/**
	 * Build ExtensionDetails from cached ExtensionInfo (no re-parsing)
	 */
	private _buildExtensionDetails(extensionInfo: ExtensionInfo): ExtensionDetails {
		// Extract bugs URL from repository if available
		let bugsUrl: string | undefined;
		if (extensionInfo.repository) {
			// Try to construct bugs URL from repository URL
			if (extensionInfo.repository.includes('github.com')) {
				bugsUrl = `${extensionInfo.repository.replace(/\.git$/, '')}/issues`;
			} else if (extensionInfo.repository.includes('gitlab.com')) {
				bugsUrl = `${extensionInfo.repository.replace(/\.git$/, '')}/issues`;
			}
		}

		// Handle bugs URL from package.json if available
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
			engines: extensionInfo.engines
		};
	}

	/**
	 * Handle extension installation from details view
	 */
	private async _handleInstallExtension(extensionInfo: ExtensionInfo): Promise<void> {
		try {
			const success = await this._storageProvider.installExtension(extensionInfo);
			if (success && this._panel) {
				// Update the webview to reflect new installation status
				this._extensionDetails = this._buildExtensionDetails(extensionInfo);
				this._panel.webview.html = this._getWebviewContent();

				// Send message to update UI immediately
				this._panel.webview.postMessage({
					command: 'installComplete',
					success: true
				});
			}
		} catch (error) {
			console.error('Error installing extension from details view:', error);
			if (this._panel) {
				this._panel.webview.postMessage({
					command: 'installComplete',
					success: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
	}

	/**
	 * Handle extension uninstallation from details view
	 */
	private async _handleUninstallExtension(extensionId: string): Promise<void> {
		try {
			const success = await this._storageProvider.uninstallExtension(extensionId);
			if (success && this._panel) {
				// Find updated extension info
				const updatedExtensionInfo = this._storageProvider.getExtensionById(extensionId);
				if (updatedExtensionInfo) {
					this._extensionDetails = this._buildExtensionDetails(updatedExtensionInfo);
					this._panel.webview.html = this._getWebviewContent();
				}

				// Send message to update UI immediately
				this._panel.webview.postMessage({
					command: 'uninstallComplete',
					success: true
				});
			}
		} catch (error) {
			console.error('Error uninstalling extension from details view:', error);
			if (this._panel) {
				this._panel.webview.postMessage({
					command: 'uninstallComplete',
					success: false,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}
	}

	private _getWebviewContent(): string {
		if (!this._extensionDetails || !this._panel) {
			return '';
		}

		const webview = this._panel.webview;
		const details = this._extensionDetails;

		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleDetailsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'extension-details.css'));

		const nonce = this._getNonce();

		// Convert markdown to HTML using marked
		let readmeHtml = details.readme ?
			marked.parse(details.readme) :
			'<p>No README.md found in this extension.</p>';

		let changelogHtml = details.changelog ?
			marked.parse(details.changelog) :
			'<p>No CHANGELOG.md found in this extension.</p>';

		// Check if extension is currently installed
		const isInstalled = this._storageProvider.isExtensionInstalled(details.id);

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
	<!-- Header Section -->
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
					${!isInstalled ? `
						<button class="install-button" id="install-btn">
							<span class="codicon codicon-cloud-download"></span>
							Install
						</button>
					` : `
						<button class="uninstall-button" id="uninstall-btn">
							<span class="codicon codicon-trash"></span>
							Uninstall
						</button>
					`}
					<span class="settings-gear codicon codicon-gear" id="settings-gear"></span>
				</div>
			</div>
		</div>
	</div>

	<!-- Sidebar -->
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
					<span class="status-badge ${isInstalled ? 'installed' : 'not-installed'}">
						${isInstalled ? 'Installed' : 'Not Installed'}
					</span>
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
					${details.homepage ? `<a href="#" class="resource-link" data-url="${details.homepage}">Homepage</a>` : ''}
					${details.repository ? `<a href="#" class="resource-link" data-url="${details.repository}">Repository</a>` : ''}
					${details.bugs ? `<a href="#" class="resource-link" data-url="${details.bugs}">Report Issues</a>` : ''}
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

	<!-- Main Content -->
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
					</div>
				</div>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		
		// Tab switching
		document.querySelectorAll('.tab-button').forEach(button => {
			button.addEventListener('click', () => {
				const tabName = button.dataset.tab;
				
				// Update active button
				document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
				button.classList.add('active');
				
				// Update active content
				document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
				document.getElementById(tabName + '-tab').classList.add('active');
			});
		});
		
		// Open URL function
		function openUrl(url) {
			if (url === '#') return; // Skip placeholder links
			console.log('Opening URL:', url);
			try {
				vscode.postMessage({
					command: 'openUrl',
					url: url
				});
			} catch (error) {
				console.error('Error opening URL:', error);
			}
		}
		
		// Install extension function
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
		
		// Uninstall extension function
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
		
		// Event listeners setup
		document.addEventListener('DOMContentLoaded', () => {
			// Install button
			const installBtn = document.getElementById('install-btn');
			if (installBtn) {
				installBtn.addEventListener('click', installExtension);
			}
			
			// Uninstall button
			const uninstallBtn = document.getElementById('uninstall-btn');
			if (uninstallBtn) {
				uninstallBtn.addEventListener('click', uninstallExtension);
			}
			
			// Settings gear
			const settingsGear = document.getElementById('settings-gear');
			if (settingsGear) {
				settingsGear.addEventListener('click', () => {
					console.log('Settings gear clicked');
				});
			}
			
			// Resource links
			document.querySelectorAll('.resource-link[data-url]').forEach(link => {
				link.addEventListener('click', (e) => {
					e.preventDefault();
					const url = link.getAttribute('data-url');
					if (url) {
						openUrl(url);
					}
				});
			});
		});
		
		// Handle messages from extension
		window.addEventListener('message', event => {
			const message = event.data;
			
			switch (message.command) {
				case 'installComplete':
					const installBtn = document.getElementById('install-btn');
					if (installBtn) {
						if (message.success) {
							// Button will be replaced by page refresh, but provide immediate feedback
							installBtn.innerHTML = '<span class="codicon codicon-check"></span> Installed!';
							installBtn.style.backgroundColor = 'var(--vscode-charts-green)';
						} else {
							installBtn.innerHTML = '<span class="codicon codicon-cloud-download"></span> Install';
							installBtn.disabled = false;
						}
					}
					break;
					
				case 'uninstallComplete':
					const uninstallBtn = document.getElementById('uninstall-btn');
					if (uninstallBtn) {
						if (message.success) {
							uninstallBtn.innerHTML = '<span class="codicon codicon-check"></span> Uninstalled!';
							uninstallBtn.style.backgroundColor = 'var(--vscode-charts-green)';
						} else {
							uninstallBtn.innerHTML = '<span class="codicon codicon-trash"></span> Uninstall';
							uninstallBtn.disabled = false;
						}
					}
					break;
			}
		});
		
		// Debug: Log when script loads
		console.log('Extension details script loaded');
		
		// Add click handler for markdown links
		document.addEventListener('click', function(e) {
			const link = e.target.closest('a');
			if (link && link.href && !link.href.startsWith('javascript:') && link.href !== window.location.href + '#') {
				// Handle external links in markdown content
				e.preventDefault();
				const href = link.getAttribute('href') || link.href;
				if (href && href !== '#' && !href.startsWith('javascript:')) {
					console.log('Markdown link handler:', href);
					openUrl(href);
				}
			}
		});
	</script>
</body>
</html>`;
	}

	/**
	 * Helper to shorten file paths for display
	 */
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

		const availableLength = maxLength - fileName.length - 3; // 3 for "..."
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
}
