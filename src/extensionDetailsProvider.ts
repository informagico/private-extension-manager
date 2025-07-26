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
					`Extension Details: ${this._extensionDetails.title}`,
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
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

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
	<link href="${styleMainUri}" rel="stylesheet">
	<title>Extension Details</title>
	<style>
		.extension-details {
			padding: 20px;
			max-width: 800px;
			margin: 0 auto;
		}
		
		.extension-header {
			display: flex;
			align-items: center;
			gap: 16px;
			margin-bottom: 24px;
			padding-bottom: 16px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		
		.extension-icon {
			width: 64px;
			height: 64px;
			border-radius: 4px;
			object-fit: cover;
		}
		
		.icon-placeholder {
			width: 64px;
			height: 64px;
			background: linear-gradient(135deg, var(--vscode-button-background), var(--vscode-button-hoverBackground));
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--vscode-button-foreground);
			font-size: 32px;
			border-radius: 4px;
		}
		
		.extension-info h1 {
			margin: 0 0 4px 0;
			font-size: 24px;
			color: var(--vscode-foreground);
		}
		
		.extension-meta {
			color: var(--vscode-descriptionForeground);
			font-size: 14px;
			margin: 4px 0;
		}
		
		.extension-description {
			margin: 8px 0;
			color: var(--vscode-foreground);
			font-size: 14px;
		}
		
		.extension-links {
			display: flex;
			gap: 12px;
			margin-top: 12px;
		}
		
		.extension-link {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
			font-size: 13px;
			padding: 4px 8px;
			border-radius: 2px;
			border: 1px solid var(--vscode-textLink-foreground);
			transition: background-color 0.2s;
		}
		
		.extension-link:hover {
			background-color: var(--vscode-textLink-activeForeground);
			color: var(--vscode-editor-background);
		}
		
		.tabs-container {
			margin-top: 24px;
		}
		
		.tabs-header {
			display: flex;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		
		.tab-button {
			background: none;
			border: none;
			padding: 12px 16px;
			cursor: pointer;
			color: var(--vscode-descriptionForeground);
			font-size: 14px;
			border-bottom: 2px solid transparent;
			transition: all 0.2s;
		}
		
		.tab-button.active {
			color: var(--vscode-foreground);
			border-bottom-color: var(--vscode-focusBorder);
		}
		
		.tab-button:hover {
			background-color: var(--vscode-list-hoverBackground);
		}
		
		.tab-content {
			display: none;
			padding: 20px 0;
		}
		
		.tab-content.active {
			display: block;
		}
		
		.markdown-content {
			color: var(--vscode-foreground);
			line-height: 1.6;
		}
		
		.markdown-content h1,
		.markdown-content h2,
		.markdown-content h3,
		.markdown-content h4,
		.markdown-content h5,
		.markdown-content h6 {
			color: var(--vscode-foreground);
			margin-top: 24px;
			margin-bottom: 12px;
		}
		
		.markdown-content h1 { font-size: 1.8em; }
		.markdown-content h2 { font-size: 1.5em; }
		.markdown-content h3 { font-size: 1.3em; }
		.markdown-content h4 { font-size: 1.1em; }
		
		.markdown-content p {
			margin: 12px 0;
		}
		
		.markdown-content ul,
		.markdown-content ol {
			margin: 12px 0;
			padding-left: 24px;
		}
		
		.markdown-content li {
			margin: 4px 0;
		}
		
		.markdown-content code {
			background-color: var(--vscode-textBlockQuote-background);
			color: var(--vscode-textPreformat-foreground);
			padding: 2px 4px;
			border-radius: 2px;
			font-family: var(--vscode-editor-font-family, monospace);
		}
		
		.markdown-content pre {
			background-color: var(--vscode-textBlockQuote-background);
			padding: 12px;
			border-radius: 4px;
			overflow-x: auto;
			margin: 12px 0;
		}
		
		.markdown-content pre code {
			background: none;
			padding: 0;
		}
		
		.markdown-content blockquote {
			border-left: 4px solid var(--vscode-textBlockQuote-border);
			background-color: var(--vscode-textBlockQuote-background);
			padding: 8px 12px;
			margin: 12px 0;
		}
		
		.markdown-content a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
		}
		
		.markdown-content a:hover {
			text-decoration: underline;
		}

		.markdown-content table {
			border-collapse: collapse;
			width: 100%;
			margin: 12px 0;
		}

		.markdown-content th,
		.markdown-content td {
			border: 1px solid var(--vscode-panel-border);
			padding: 8px 12px;
			text-align: left;
		}

		.markdown-content th {
			background-color: var(--vscode-textBlockQuote-background);
			font-weight: bold;
		}

		.markdown-content hr {
			border: none;
			height: 1px;
			background-color: var(--vscode-panel-border);
			margin: 20px 0;
		}
		
		.categories-keywords {
			display: flex;
			gap: 16px;
			margin-top: 12px;
			flex-wrap: wrap;
		}
		
		.categories,
		.keywords {
			display: flex;
			gap: 4px;
			flex-wrap: wrap;
		}
		
		.category-tag,
		.keyword-tag {
			background-color: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 2px 6px;
			border-radius: 2px;
			font-size: 11px;
		}
		
		.file-info {
			margin-top: 12px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.image-placeholder {
			background-color: var(--vscode-textBlockQuote-background);
			color: var(--vscode-descriptionForeground);
			padding: 8px 12px;
			border-radius: 4px;
			margin: 8px 0;
			font-style: italic;
		}
	</style>
</head>
<body>
	<div class="extension-details">
		<div class="extension-header">
			<div class="extension-icon-container">
				${details.icon ? `
					<img src="${details.icon}" class="extension-icon" alt="${details.title} icon" />
				` : `
					<div class="icon-placeholder">
						<span class="codicon codicon-extensions"></span>
					</div>
				`}
			</div>
			<div class="extension-info">
				<h1>${details.title}</h1>
				<div class="extension-meta">
					<strong>${details.publisher}</strong> • Version ${details.version}
				</div>
				<div class="extension-description">${details.description}</div>
				
				${details.categories && details.categories.length > 0 ? `
					<div class="categories-keywords">
						<div>
							<strong>Categories:</strong>
							<div class="categories">
								${details.categories.map(cat => `<span class="category-tag">${cat}</span>`).join('')}
							</div>
						</div>
					</div>
				` : ''}
				
				${details.keywords && details.keywords.length > 0 ? `
					<div class="categories-keywords">
						<div>
							<strong>Keywords:</strong>
							<div class="keywords">
								${details.keywords.map(keyword => `<span class="keyword-tag">${keyword}</span>`).join('')}
							</div>
						</div>
					</div>
				` : ''}
				
				<div class="extension-links">
					${details.homepage ? `<a href="#" class="extension-link" onclick="openUrl('${details.homepage}')">Homepage</a>` : ''}
					${details.repository ? `<a href="#" class="extension-link" onclick="openUrl('${details.repository}')">Repository</a>` : ''}
					${details.bugs ? `<a href="#" class="extension-link" onclick="openUrl('${details.bugs}')">Issues</a>` : ''}
				</div>
				
				<div class="file-info">
					<div><strong>File:</strong> ${details.filePath}</div>
					<div><strong>Size:</strong> ${VsixUtils.formatFileSize(details.fileSize)}</div>
					<div><strong>Modified:</strong> ${details.lastModified.toLocaleString()}</div>
					${details.license ? `<div><strong>License:</strong> ${details.license}</div>` : ''}
					${details.engines ? `<div><strong>VS Code:</strong> ${details.engines.vscode || 'N/A'}</div>` : ''}
				</div>
			</div>
		</div>
		
		<div class="tabs-container">
			<div class="tabs-header">
				<button class="tab-button active" data-tab="details">DETAILS</button>
				<button class="tab-button" data-tab="changelog">CHANGELOG</button>
			</div>
			
			<div class="tab-content active" id="details-tab">
				<div class="markdown-content">
					${readmeHtml}
				</div>
			</div>
			
			<div class="tab-content" id="changelog-tab">
				<div class="markdown-content">
					${changelogHtml}
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
