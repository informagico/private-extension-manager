import * as vscode from 'vscode';
import { StorageProvider, ExtensionInfo } from './storageProvider';
import { ExtensionDetailsProvider } from './extensionDetailsProvider';

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
	private _loadingPromise?: Promise<void>;
	private _isScanning = false;
	private _detailsProvider: ExtensionDetailsProvider;
	private _selectedExtensionId?: string;

	constructor(private readonly _extensionUri: vscode.Uri, private readonly _context: vscode.ExtensionContext) {
		this._storageProvider = new StorageProvider(_context);

		// Pass storage provider to details provider
		this._detailsProvider = new ExtensionDetailsProvider(_extensionUri, this._storageProvider);

		// Listen for storage changes and automatically refresh webview
		this._storageProvider.onDidChange(extensions => {
			console.log(`Storage changed: ${extensions.length} extensions`);
			this._items = this.convertExtensionsToSidebarItems(extensions);

			// Automatically refresh the webview if it's visible
			if (this._view) {
				console.log('Refreshing webview with new data');
				this._view.webview.html = this._getHtmlForWebview(this._view.webview);

				// Notify the webview that data has been refreshed and restore selection
				this._view.webview.postMessage({
					command: 'scanComplete',
					count: this._items.length,
					selectedExtensionId: this._selectedExtensionId
				});
			}
		});

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

		// Initially set the HTML
		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// If we already have data loaded, notify the webview
		if (this._items.length > 0) {
			setTimeout(() => {
				webviewView.webview.postMessage({
					command: 'scanComplete',
					count: this._items.length,
					selectedExtensionId: this._selectedExtensionId
				});
			}, 100);
		}

		webviewView.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'itemClicked':
						await this._handleItemClick(message.itemId);
						break;
					case 'deleteItem':
						this._uninstallExtension(message.itemId);
						break;
					case 'toggleStatus':
						this._toggleItemStatus(message.itemId);
						break;
					case 'installItem':
						this._installExtension(message.itemId);
						break;
					case 'updateItem':
						this._updateExtension(message.itemId);
						break;
					case 'refresh':
						this.scanDirectories();
						break;
					case 'addItem':
						this.addDirectory();
						break;
				}
			},
			undefined,
			[]
		);
	}

	/**
	 * Scan directories in background and trigger storage refresh
	 * This method can be called at startup and prevents multiple concurrent scans
	 */
	public async scanDirectoriesInBackground(): Promise<void> {
		console.log('SidebarProvider: scanDirectoriesInBackground called');

		// Prevent multiple concurrent scans
		if (this._isScanning) {
			console.log('SidebarProvider: Scan already in progress, skipping...');
			return;
		}

		// If there's already a loading operation, wait for it
		if (this._loadingPromise) {
			console.log('SidebarProvider: Waiting for existing loading operation...');
			return this._loadingPromise;
		}

		this._isScanning = true;
		this._loadingPromise = this._performBackgroundScan();

		try {
			await this._loadingPromise;
			console.log('SidebarProvider: scanDirectoriesInBackground completed successfully');
		} catch (error) {
			console.error('SidebarProvider: scanDirectoriesInBackground failed:', error);
			throw error;
		} finally {
			this._isScanning = false;
			this._loadingPromise = undefined;
		}
	}

	/**
	 * Internal method to perform the actual background scan
	 */
	private async _performBackgroundScan(): Promise<void> {
		try {
			console.log('SidebarProvider: Starting background directory scan...');

			// Add timeout to the storage provider refresh
			const refreshPromise = this._storageProvider.refresh();
			const timeoutPromise = new Promise<ExtensionInfo[]>((_, reject) => {
				setTimeout(() => reject(new Error('Storage provider refresh timeout after 25 seconds')), 25000);
			});

			const extensions = await Promise.race([refreshPromise, timeoutPromise]);
			console.log(`SidebarProvider: Background scan complete: found ${extensions.length} extensions`);

			// The storage provider will emit onDidChange event, which will update the UI
			return;
		} catch (error) {
			console.error('SidebarProvider: Error during background directory scan:', error);
			throw error;
		}
	}

	/**
	 * Get current extension count (useful for startup feedback)
	 */
	public getExtensionCount(): number {
		return this._items.length;
	}

	/**
	 * Check if extensions are currently being loaded
	 */
	public isLoading(): boolean {
		return this._loadingPromise !== undefined;
	}

	public async refresh(): Promise<void> {
		// Prevent multiple concurrent refreshes
		if (this._isScanning) {
			console.log('SidebarProvider: Scan in progress, skipping manual refresh');
			return;
		}

		console.log('SidebarProvider: Manual refresh requested');
		await this.scanDirectoriesInBackground();
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
		// Prevent multiple concurrent scans
		if (this._isScanning) {
			console.log('SidebarProvider: Scan already in progress, skipping user-triggered scan');
			return;
		}

		try {
			await vscode.window.withProgress({
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
			console.error('SidebarProvider: Error scanning directories:', error);
			vscode.window.showErrorMessage(`Error scanning directories: ${error}`);
		}
	}

	public dispose(): void {
		if (this._refreshInterval) {
			clearInterval(this._refreshInterval);
		}
		this._storageProvider.dispose();
		this._detailsProvider.dispose();
	}

	private async loadExtensions(): Promise<void> {
		try {
			const extensions = await this._storageProvider.getAllExtensions();
			this._items = this.convertExtensionsToSidebarItems(extensions);
			console.log(`Loaded ${this._items.length} extensions`);
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

	private async _handleItemClick(itemId: string): Promise<void> {
		const item = this._items.find(i => i.id === itemId);
		if (item && item.filePath) {
			try {
				// Set the selected extension ID
				this._selectedExtensionId = itemId;

				// Update the webview to show selection
				if (this._view) {
					this._view.webview.postMessage({
						command: 'setSelection',
						selectedExtensionId: itemId
					});
				}

				// Use the updated details provider that creates new windows
				await this._detailsProvider.showExtensionDetails(item.filePath);
			} catch (error) {
				console.error('Error showing extension details:', error);
				vscode.window.showErrorMessage(`Error showing extension details: ${error}`);
			}
		}
	}

	private async _installExtension(itemId: string): Promise<void> {
		const extension = this._storageProvider.getExtensionById(itemId);
		if (extension) {
			const success = await this._storageProvider.installExtension(extension);
			if (success) {
				// Refresh will happen automatically via onDidChange event
				// But we can also send immediate feedback to webview
				if (this._view) {
					this._view.webview.postMessage({
						command: 'installComplete'
					});
				}
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
					// Refresh will happen automatically via onDidChange event
					// But we can also send immediate feedback to webview
					if (this._view) {
						this._view.webview.postMessage({
							command: 'refresh'
						});
					}
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
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
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
                            <div class="item ${item.isInstalled ? 'installed' : 'not-installed'} ${this._selectedExtensionId === item.id ? 'selected' : ''}" data-item-id="${item.id}" tabindex="0">
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
                                                <button class="action-btn delete-btn" title="Uninstall">
                                                    <span class="codicon codicon-trash"></span>
                                                </button>
                                            </div>
                                        ` : `
                                            <div class="item-actions" style="display: none;">
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
