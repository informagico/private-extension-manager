import * as vscode from 'vscode';
import { StorageProvider, ExtensionInfo } from './storageProvider';

interface SidebarItem {
	id: string;
	title: string;
	description: string;
	icon: string | null;
	author: string;
	isInstalled: boolean;
	hasUpdate?: boolean;
	version?: string;
	publisher?: string;
	filePath?: string;
	fileSize?: number;
	lastModified?: Date;
	categories?: string[];
	keywords?: string[];
}

export class PrivateExtensionsSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'privateExtensionsSidebar.sidebarView';

	private _view?: vscode.WebviewView;
	private _items: SidebarItem[] = [];
	private _storageProvider: StorageProvider;
	private _refreshInterval?: NodeJS.Timeout;

	constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {
		this._storageProvider = new StorageProvider(_context);

		// Listen for storage changes
		this._storageProvider.onDidChange(extensions => {
			this._items = this.convertExtensionsToSidebarItems(extensions);
			this.refresh();
		});

		// Initialize with existing extensions
		this.loadExtensions();

		// Setup auto-refresh if enabled
		this.setupAutoRefresh();

		// Watch for configuration changes
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('privateExtensionsSidebar.scanInterval')) {
				this.setupAutoRefresh();
			}
		});
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'itemClicked':
						this._handleItemClick(message.itemId);
						break;
					case 'deleteItem':
						this._uninstallExtension(message.itemId);
						break;
					case 'toggleStatus':
						this._toggleItemStatus(message.itemId);
						break;
					case 'openInEditor':
						this._openInEditor(message.itemId);
						break;
					case 'installItem':
						this._installExtension(message.itemId);
						break;
					case 'updateItem':
						this._updateExtension(message.itemId);
						break;
					case 'showInFolder':
						this._showInFolder(message.itemId);
						break;
				}
			},
			undefined,
			[]
		);
	}

	public async refresh(): Promise<void> {
		await this.loadExtensions();
		if (this._view) {
			this._view.webview.html = this._getHtmlForWebview(this._view.webview);
		}
	}

	public async addDirectory(): Promise<void> {
		const options: vscode.OpenDialogOptions = {
			canSelectMany: true,
			canSelectFiles: false,
			canSelectFolders: true,
			openLabel: 'Select VSIX Directories'
		};

		const folderUris = await vscode.window.showOpenDialog(options);
		if (folderUris && folderUris.length > 0) {
			const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
			const currentDirs = config.get<string[]>('vsixDirectories', []);

			const newDirs = folderUris.map(uri => uri.fsPath);
			const updatedDirs = [...new Set([...currentDirs, ...newDirs])];

			await config.update('vsixDirectories', updatedDirs, vscode.ConfigurationTarget.Global);

			vscode.window.showInformationMessage(
				`Added ${newDirs.length} director${newDirs.length === 1 ? 'y' : 'ies'} to scan list`
			);

			await this.refresh();
		}
	}

	public async scanDirectories(): Promise<void> {
		try {
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Scanning VSIX directories...",
				cancellable: false
			}, async (progress) => {
				progress.report({ increment: 0 });

				const extensions = await this._storageProvider.refresh();
				progress.report({ increment: 100 });

				vscode.window.showInformationMessage(
					`Found ${extensions.length} extension${extensions.length === 1 ? '' : 's'}`
				);
			});
		} catch (error) {
			vscode.window.showErrorMessage(`Error scanning directories: ${error}`);
		}
	}

	public dispose(): void {
		if (this._refreshInterval) {
			clearInterval(this._refreshInterval);
		}
		this._storageProvider.dispose();
	}

	private async loadExtensions(): Promise<void> {
		try {
			const extensions = await this._storageProvider.getAllExtensions();
			this._items = this.convertExtensionsToSidebarItems(extensions);
		} catch (error) {
			console.error('Error loading extensions:', error);
			vscode.window.showErrorMessage(`Error loading extensions: ${error}`);
			this._items = [];
		}
	}

	private convertExtensionsToSidebarItems(extensions: ExtensionInfo[]): SidebarItem[] {
		return extensions.map(ext => ({
			id: ext.id,
			title: ext.title,
			description: ext.description,
			icon: ext.icon || null,
			author: ext.author,
			isInstalled: ext.isInstalled,
			hasUpdate: ext.hasUpdate,
			version: ext.version,
			publisher: ext.publisher,
			filePath: ext.filePath,
			fileSize: ext.fileSize,
			lastModified: ext.lastModified,
			categories: ext.categories,
			keywords: ext.keywords
		}));
	}

	private setupAutoRefresh(): void {
		if (this._refreshInterval) {
			clearInterval(this._refreshInterval);
			this._refreshInterval = undefined;
		}

		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const interval = config.get<number>('scanInterval', 30);

		if (interval > 0) {
			this._refreshInterval = setInterval(() => {
				this.refresh();
			}, interval * 1000);
		}
	}

	private _handleItemClick(itemId: string): void {
		const item = this._items.find(i => i.id === itemId);
		if (item) {
			// Show extension details
			const info = [
				`**${item.title}** v${item.version}`,
				`Publisher: ${item.publisher}`,
				`Author: ${item.author}`,
				``,
				item.description,
				``,
				`Status: ${item.isInstalled ? 'Installed' : 'Not Installed'}`,
				item.hasUpdate ? '⚠️ Update Available' : '',
				``,
				`File: ${item.filePath}`,
				item.fileSize ? `Size: ${this.formatFileSize(item.fileSize)}` : '',
				item.lastModified ? `Modified: ${item.lastModified.toLocaleString()}` : ''
			].filter(line => line !== '').join('\n');

			vscode.window.showInformationMessage(`Extension Details`, {
				detail: info,
				modal: false
			});
		}
	}

	private async _installExtension(itemId: string): Promise<void> {
		const extension = await this._storageProvider.getExtensionById(itemId);
		if (extension) {
			const success = await this._storageProvider.installExtension(extension);
			if (success) {
				await this.refresh();
			}
		}
	}

	private async _updateExtension(itemId: string): Promise<void> {
		// For updates, we reinstall the extension
		await this._installExtension(itemId);
	}

	private async _uninstallExtension(itemId: string): Promise<void> {
		const item = this._items.find(i => i.id === itemId);
		if (item && item.isInstalled) {
			const confirm = await vscode.window.showWarningMessage(
				`Are you sure you want to uninstall "${item.title}"?`,
				{ modal: true },
				'Uninstall'
			);

			if (confirm === 'Uninstall') {
				const success = await this._storageProvider.uninstallExtension(itemId);
				if (success) {
					await this.refresh();
				}
			}
		}
	}

	private _toggleItemStatus(itemId: string): void {
		const item = this._items.find(i => i.id === itemId);
		if (item) {
			if (item.isInstalled) {
				this._uninstallExtension(itemId);
			} else {
				this._installExtension(itemId);
			}
		}
	}

	private _openInEditor(itemId: string): void {
		const item = this._items.find(i => i.id === itemId);
		if (item) {
			const content = [
				`# ${item.title}`,
				``,
				`**Version:** ${item.version}`,
				`**Publisher:** ${item.publisher}`,
				`**Author:** ${item.author}`,
				`**Status:** ${item.isInstalled ? 'Installed' : 'Not Installed'}`,
				item.hasUpdate ? `**Update Available:** Yes` : '',
				``,
				`## Description`,
				item.description,
				``,
				`## File Information`,
				`- **Path:** ${item.filePath}`,
				item.fileSize ? `- **Size:** ${this.formatFileSize(item.fileSize)}` : '',
				item.lastModified ? `- **Modified:** ${item.lastModified.toLocaleString()}` : '',
				``,
				item.categories && item.categories.length > 0 ? `## Categories` : '',
				item.categories && item.categories.length > 0 ? item.categories.map(cat => `- ${cat}`).join('\n') : '',
				``,
				item.keywords && item.keywords.length > 0 ? `## Keywords` : '',
				item.keywords && item.keywords.length > 0 ? item.keywords.join(', ') : ''
			].filter(line => line !== '').join('\n');

			vscode.workspace.openTextDocument({
				content,
				language: 'markdown'
			}).then(doc => {
				vscode.window.showTextDocument(doc);
			});
		}
	}

	private _showInFolder(itemId: string): void {
		const item = this._items.find(i => i.id === itemId);
		if (item && item.filePath) {
			vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.filePath));
		}
	}

	private formatFileSize(bytes: number): string {
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		if (bytes === 0) return '0 Bytes';
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
	}

	private _getSortedItems(): SidebarItem[] {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const sortBy = config.get<string>('sortBy', 'name');
		const sortOrder = config.get<string>('sortOrder', 'ascending');

		const sortedItems = [...this._items].sort((a, b) => {
			// Priority 1: Items with updates available (installed + hasUpdate)
			const aHasUpdate = a.isInstalled && a.hasUpdate;
			const bHasUpdate = b.isInstalled && b.hasUpdate;

			if (aHasUpdate && !bHasUpdate) return -1;
			if (!aHasUpdate && bHasUpdate) return 1;

			// Priority 2: Installed items (without updates)
			const aInstalledNoUpdate = a.isInstalled && !a.hasUpdate;
			const bInstalledNoUpdate = b.isInstalled && !b.hasUpdate;

			if (aInstalledNoUpdate && !bInstalledNoUpdate && !bHasUpdate) return -1;
			if (!aInstalledNoUpdate && bInstalledNoUpdate && !aHasUpdate) return 1;

			// Priority 3: Not installed items
			if (!a.isInstalled && b.isInstalled) return 1;
			if (a.isInstalled && !b.isInstalled) return -1;

			// Within same category, sort by configured criteria
			let comparison = 0;
			switch (sortBy) {
				case 'name':
					comparison = a.title.localeCompare(b.title);
					break;
				case 'author':
					comparison = a.author.localeCompare(b.author);
					break;
				case 'lastModified':
					if (a.lastModified && b.lastModified) {
						comparison = a.lastModified.getTime() - b.lastModified.getTime();
					} else if (a.lastModified) {
						comparison = -1;
					} else if (b.lastModified) {
						comparison = 1;
					}
					break;
				case 'fileSize':
					comparison = (a.fileSize || 0) - (b.fileSize || 0);
					break;
				case 'version':
					if (a.version && b.version) {
						comparison = this.compareVersions(a.version, b.version);
					}
					break;
				default:
					comparison = a.title.localeCompare(b.title);
			}

			return sortOrder === 'descending' ? -comparison : comparison;
		});

		return sortedItems;
	}

	private compareVersions(version1: string, version2: string): number {
		const v1Parts = version1.split('.').map(Number);
		const v2Parts = version2.split('.').map(Number);

		const maxLength = Math.max(v1Parts.length, v2Parts.length);

		for (let i = 0; i < maxLength; i++) {
			const v1Part = v1Parts[i] || 0;
			const v2Part = v2Parts[i] || 0;

			if (v1Part > v2Part) return 1;
			if (v1Part < v2Part) return -1;
		}

		return 0;
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		const nonce = getNonce();
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const showFileSize = config.get<boolean>('showFileSize', false);
		const showLastModified = config.get<boolean>('showLastModified', false);

		return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">
                <title>Private Extensions</title>
            </head>
            <body>
                <div class="container">
                    <div class="search-container">
                        <input type="text" id="search-input" placeholder="Search Extensions in Private Marketplace" />
                    </div>
                    
                    <div class="items-container">
                        ${this._getSortedItems().length === 0 ? `
                            <div class="empty-state">
                                <div class="codicon codicon-folder-opened"></div>
                                <div>No extensions found</div>
                                <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">
                                    Configure directories in settings or click the + button to add directories
                                </div>
                            </div>
                        ` : this._getSortedItems().map(item => `
                            <div class="item ${item.isInstalled ? 'installed' : 'not-installed'}" data-item-id="${item.id}" tabindex="0">
                                <div class="item-icon-container">
                                    <div class="item-main-icon">
                                        ${item.icon ? `
                                            <img src="${item.icon}" class="extension-icon" />
                                        ` : `
                                            <div class="icon-placeholder">
                                                <span class="codicon codicon-extensions"></span>
                                            </div>
                                        `}
                                    </div>
                                    ${item.hasUpdate ? `
                                        <div class="update-badge" title="Update Available">
                                            <span class="codicon codicon-arrow-up"></span>
                                        </div>
                                    ` : ''}
                                </div>
                                <div class="item-content">
                                    <!-- Row 1: Title -->
                                    <div class="item-header">
                                        <div class="item-title">${item.title}</div>
                                        ${item.isInstalled ? `
                                            <div class="item-actions">
                                                <button class="action-btn toggle-status-btn" title="Toggle Status">
                                                    <span class="codicon codicon-circle-filled"></span>
                                                </button>
                                                <button class="action-btn open-btn" title="Open in Editor">
                                                    <span class="codicon codicon-go-to-file"></span>
                                                </button>
                                                <button class="action-btn show-folder-btn" title="Show in Folder">
                                                    <span class="codicon codicon-folder-opened"></span>
                                                </button>
                                                <button class="action-btn delete-btn" title="Uninstall">
                                                    <span class="codicon codicon-trash"></span>
                                                </button>
                                            </div>
                                        ` : `
                                            <div class="item-actions">
                                                <button class="action-btn show-folder-btn" title="Show in Folder">
                                                    <span class="codicon codicon-folder-opened"></span>
                                                </button>
                                            </div>
                                        `}
                                    </div>
                                    
                                    <!-- Row 2: Description -->
                                    <div class="item-description">${item.description}</div>
                                    
                                    <!-- Row 3: Author and buttons -->
                                    <div class="item-meta-wrapper">
                                        <div class="item-meta">
                                            <div class="item-author">
                                                <span class="author-name">${item.author}</span>
                                                ${item.version ? `<span class="version">v${item.version}</span>` : ''}
                                            </div>
                                            ${showFileSize && item.fileSize ? `
                                                <div class="file-info">
                                                    <span class="file-size">${this.formatFileSize(item.fileSize)}</span>
                                                </div>
                                            ` : ''}
                                            ${showLastModified && item.lastModified ? `
                                                <div class="file-info">
                                                    <span class="last-modified">${item.lastModified.toLocaleDateString()}</span>
                                                </div>
                                            ` : ''}
                                        </div>
                                        ${!item.isInstalled ? `
                                            <button class="install-btn" data-item-id="${item.id}">
                                                <span class="codicon codicon-cloud-download"></span>
                                                Install
                                            </button>
                                        ` : item.hasUpdate ? `
                                            <button class="update-btn" data-item-id="${item.id}">
                                                <span class="codicon codicon-arrow-up"></span>
                                                Update
                                            </button>
                                        ` : `
                                            <div class="installed-badge">
                                                <span class="codicon codicon-check"></span>
                                                Installed
                                            </div>
                                        `}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
