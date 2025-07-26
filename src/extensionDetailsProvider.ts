import * as vscode from 'vscode';
import { marked } from 'marked';
import { VsixParser } from './vsixParser';
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

	constructor(private readonly _extensionUri: vscode.Uri) {
		// Simple marked configuration that should work with any version
	}

	public async showExtensionDetails(filePath: string): Promise<void> {
		try {
			// Parse the extension
			const parser = new VsixParser(filePath);
			const parseResult = await parser.parse();

			if (!parseResult.packageJson) {
				vscode.window.showErrorMessage('Could not parse extension package.json');
				return;
			}

			// Extract README and CHANGELOG
			const readme = await parser.extractReadme();
			const changelog = await parser.extractChangelog();

			// Build extension details
			this._extensionDetails = {
				id: `${parseResult.packageJson.publisher}.${parseResult.packageJson.name}`,
				title: VsixUtils.generateDisplayName(parseResult.packageJson),
				displayName: parseResult.packageJson.displayName || parseResult.packageJson.name,
				description: parseResult.packageJson.description || 'No description available',
				version: parseResult.packageJson.version,
				publisher: parseResult.packageJson.publisher,
				author: this._getAuthorName(parseResult.packageJson.author),
				icon: parseResult.packageJson.icon ? await this._extractIconAsDataUrl(parser, parseResult.packageJson.icon) : undefined,
				categories: parseResult.packageJson.categories,
				keywords: parseResult.packageJson.keywords,
				filePath,
				fileSize: parseResult.fileSize,
				lastModified: parseResult.lastModified,
				readme: readme || undefined,
				changelog: changelog || undefined,
				repository: typeof parseResult.packageJson.repository === 'string'
					? parseResult.packageJson.repository
					: parseResult.packageJson.repository?.url,
				bugs: typeof parseResult.packageJson.bugs === 'string'
					? parseResult.packageJson.bugs
					: parseResult.packageJson.bugs?.url,
				homepage: parseResult.packageJson.homepage,
				license: parseResult.packageJson.license,
				engines: parseResult.packageJson.engines
			};

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

	private _getAuthorName(author: any): string {
		if (typeof author === 'string') {
			return author;
		} else if (author && typeof author === 'object' && author.name) {
			return author.name;
		}
		return 'Unknown';
	}

	private async _extractIconAsDataUrl(parser: VsixParser, iconPath: string): Promise<string | undefined> {
		try {
			const iconBuffer = await parser.extractIcon(iconPath);
			if (iconBuffer) {
				const mimeType = VsixParser.getMimeTypeFromExtension(iconPath.substring(iconPath.lastIndexOf('.')));
				return `data:${mimeType};base64,${iconBuffer.toString('base64')}`;
			}
		} catch (error) {
			console.error('Error extracting icon:', error);
		}
		return undefined;
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
					<span class="publisher-name" onclick="openUrl('#')">${details.publisher}</span>
				</div>
				<div class="extension-description">${details.description}</div>
				<div class="extension-actions">
					<button class="install-button">
						<span class="codicon codicon-cloud-download"></span>
						Install
					</button>
					<span class="settings-gear codicon codicon-gear"></span>
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
					${details.homepage ? `<a href="${details.homepage}" class="resource-link" onclick="openUrl('${details.homepage}')">Homepage</a>` : ''}
					${details.repository ? `<a href="${details.repository}" class="resource-link" onclick="openUrl('${details.repository}')">Repository</a>` : ''}
				</div>
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
						<h2>Troubleshooting</h2>
						<div class="troubleshooting-item">
							<div class="troubleshooting-title">Windows:</div>
							<div class="troubleshooting-content">
								Do not run your VSCode or Discord as admin, there is no reason to and it just further complicates everything down the line.
							</div>
						</div>
						<div class="troubleshooting-item">
							<div class="troubleshooting-title">Linux:</div>
							<div class="troubleshooting-content">
								Discord versions installed using <code>flatpak</code> or <code>snap</code> need modifications in order to support IPC. In order to avoid this (and as Discord itself suggests) you should download it from discord.com
							</div>
						</div>
						
						<h3>File Information</h3>
						<p><strong>File Path:</strong> ${details.filePath}</p>
						<p><strong>File Size:</strong> ${VsixUtils.formatFileSize(details.fileSize)}</p>
						<p><strong>VS Code Engine:</strong> ${details.engines?.vscode || 'Not specified'}</p>
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
		
		// Make openUrl available globally
		window.openUrl = openUrl;
		
		// Install button click handler
		document.querySelector('.install-button')?.addEventListener('click', () => {
			// You can add install functionality here
			console.log('Install button clicked');
		});
		
		// Settings gear click handler
		document.querySelector('.settings-gear')?.addEventListener('click', () => {
			// You can add settings functionality here
			console.log('Settings gear clicked');
		});
		
		// Debug: Log when script loads
		console.log('Extension details script loaded');
		console.log('Available functions:', typeof window.openUrl);
		
		// Add click handler for all links as fallback
		document.addEventListener('click', function(e) {
			const link = e.target.closest('a');
			if (link && link.getAttribute('href') === '#' && link.onclick) {
				// Let the onclick handler work
				return;
			} else if (link && link.href && !link.href.startsWith('javascript:')) {
				// Fallback for any missed links
				e.preventDefault();
				const href = link.getAttribute('href') || link.href;
				if (href && href !== '#') {
					console.log('Fallback link handler:', href);
					openUrl(href);
				}
			}
		});
	</script>
</body>
</html>`;
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
