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
	source: 'local' | 'openvsx';
	namespace?: string;
	downloadCount?: number;
	rating?: number;
	reviewCount?: number;
	verified?: boolean;
	deprecated?: boolean;
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
	private _lastSearchQuery: string = '';
	private _searchTimeout?: NodeJS.Timeout;

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
					case 'search':
						// Handle unified search
						await this._handleUnifiedSearch(message.query);
						break;
					case 'clearRemoteCache':
						this._storageProvider.clearRemoteCache();
						vscode.window.showInformationMessage('Remote extension cache cleared');
						break;
					case 'showPopular':
						await this.showPopularExtensions();
						break;
					case 'openUrl':
						if (message.url) {
							vscode.env.openExternal(vscode.Uri.parse(message.url));
						}
						break;
				}
			},
			undefined,
			[]
		);
	}

	/**
	 * Handle unified search (both local and remote)
	 */
	private async _handleUnifiedSearch(query: string): Promise<void> {
		if (this._searchTimeout) {
			clearTimeout(this._searchTimeout);
		}

		// Debounce search requests to avoid too many API calls
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const debounceDelay = config.get<number>('searchDebounceDelay', 300);
		const minLength = config.get<number>('remoteSearchMinLength', 3);

		this._searchTimeout = setTimeout(async () => {
			try {
				this._lastSearchQuery = query;

				// Show loading state for remote searches
				if (query.trim().length >= minLength) {
					if (this._view) {
						this._view.webview.postMessage({
							command: 'searchStarted',
							query: query
						});
					}
				}

				// Perform unified search
				const results = await this._storageProvider.searchExtensionsUnified(query, {
					source: 'all'
				});

				// Convert to sidebar items
				this._items = this.convertExtensionsToSidebarItems(results);

				// Update webview
				if (this._view) {
					this._view.webview.html = this._getHtmlForWebview(this._view.webview);
					this._view.webview.postMessage({
						command: 'searchComplete',
						count: this._items.length,
						query: query,
						hasRemoteResults: results.some(r => r.source === 'openvsx')
					});
				}

			} catch (error) {
				console.error('Error in unified search:', error);
				if (this._view) {
					this._view.webview.postMessage({
						command: 'searchError',
						message: `Search error: ${error}`,
						query: query
					});
				}
			}
		}, query.trim().length >= minLength ? debounceDelay : 100);
	}

	/**
	 * Show popular extensions from OpenVSX
	 */
	public async showPopularExtensions(): Promise<void> {
		try {
			const popular = await this._storageProvider.getPopularExtensions(20);
			this._items = this.convertExtensionsToSidebarItems(popular);

			if (this._view) {
				this._view.webview.html = this._getHtmlForWebview(this._view.webview);
				this._view.webview.postMessage({
					command: 'searchComplete',
					count: this._items.length,
					query: 'popular',
					hasRemoteResults: true
				});
			}

			vscode.window.showInformationMessage(`Showing ${popular.length} popular extensions from OpenVSX`);
		} catch (error) {
			console.error('Error showing popular extensions:', error);
			vscode.window.showErrorMessage(`Failed to load popular extensions: ${error}`);
		}
	}

	/**
	 * Clear all caches
	 */
	public async clearAllCaches(): Promise<void> {
		this._storageProvider.clearRemoteCache();
		await this.scanDirectories();
	}

	/**
	 * Clear remote cache only
	 */
	public async clearRemoteCache(): Promise<void> {
		this._storageProvider.clearRemoteCache();
		// Refresh current view if it contains remote results
		if (this._items.some(item => item.source === 'openvsx')) {
			await this._handleUnifiedSearch(this._lastSearchQuery);
		}
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
		if (this._searchTimeout) {
			clearTimeout(this._searchTimeout);
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
			keywords: ext.keywords,
			source: ext.source,
			namespace: ext.namespace,
			downloadCount: ext.downloadCount,
			rating: ext.rating,
			reviewCount: ext.reviewCount,
			verified: ext.verified,
			deprecated: ext.deprecated
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

	/**
	 * Enhanced item click handler that supports remote extensions
	 */
	private async _handleItemClick(itemId: string): Promise<void> {
		const item = this._items.find(i => i.id === itemId);
		if (!item) return;

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

			// Handle remote extensions differently
			if (item.source === 'openvsx') {
				// For remote extensions, we need to get full details first
				const remoteDetails = await this._storageProvider.getRemoteExtensionDetails(itemId);
				if (remoteDetails) {
					// Create a temporary VSIX-like object for the details view
					const tempFilePath = `openvsx://${item.namespace}/${item.title}`;
					await this._detailsProvider.showExtensionDetails(tempFilePath);
				} else {
					vscode.window.showErrorMessage('Failed to load extension details from OpenVSX');
				}
			} else {
				// Local extension - use existing logic
				if (item.filePath) {
					await this._detailsProvider.showExtensionDetails(item.filePath);
				}
			}
		} catch (error) {
			console.error('Error showing extension details:', error);
			vscode.window.showErrorMessage(`Error showing extension details: ${error}`);
		}
	}

	/**
	 * Enhanced install handler for both local and remote extensions
	 */
	private async _installExtension(itemId: string): Promise<void> {
		const item = this._items.find(i => i.id === itemId);
		if (!item) return;

		const extension = item.source === 'local' 
			? this._storageProvider.getExtensionById(itemId)
			: await this._storageProvider.getRemoteExtensionDetails(itemId);
		
		if (extension) {
			let success: boolean;
			
			if (extension.source === 'openvsx') {
				success = await this._storageProvider.installOpenVSXExtension(extension);
			} else {
				success = await this._storageProvider.installExtension(extension);
			}

			if (success) {
				// Refresh will happen automatically via onDidChange event
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

	/**
	 * Format download count for display
	 */
	private formatDownloadCount(count: number): string {
		if (count < 1000) return count.toString();
		if (count < 1000000) return Math.round(count / 100) / 10 + 'K';
		return Math.round(count / 100000) / 10 + 'M';
	}

	/**
	 * Enhanced sorting that considers remote extension metrics
	 */
	private _getSortedItems(): SidebarItem[] {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const sortBy = config.get<string>('sortBy', 'name');
		const sortOrder = config.get<string>('sortOrder', 'ascending');
		const preferLocal = config.get<boolean>('preferLocalExtensions', true);

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

			// Priority 3: Local extensions over remote (when searching and preference enabled)
			if (this._lastSearchQuery && preferLocal && a.source !== b.source) {
				if (a.source === 'local' && b.source === 'openvsx') return -1;
				if (a.source === 'openvsx' && b.source === 'local') return 1;
			}

			// Priority 4: Not installed items
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
				case 'downloads':
					// Sort by download count for remote extensions
					if (a.source === 'openvsx' && b.source === 'openvsx') {
						comparison = (b.downloadCount || 0) - (a.downloadCount || 0);
					} else {
						comparison = a.title.localeCompare(b.title);
					}
					break;
				case 'rating':
					// Sort by rating for remote extensions
					if (a.source === 'openvsx' && b.source === 'openvsx') {
						comparison = (b.rating || 0) - (a.rating || 0);
					} else {
						comparison = a.title.localeCompare(b.title);
					}
					break;
				case 'relevance':
					// For search results, maintain the order from unified search
					return 0;
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
		const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));

		const nonce = getNonce();
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const showFileSize = config.get<boolean>('showFileSize', false);
		const showLastModified = config.get<boolean>('showLastModified', false);
		const showDownloadCount = config.get<boolean>('showDownloadCount', true);
		const showRating = config.get<boolean>('showRating', true);
		const showSourceIndicators = config.get<boolean>('showSourceIndicators', true);

		return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource}; connect-src https://open-vsx.org;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${codiconsUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">
                <title>Private Extensions</title>
            </head>
            <body>
                <div class="container">
                    <div class="search-container">
                        <input type="text" id="search-input" placeholder="Search local and OpenVSX extensions..." />
                        <div class="search-info">
                            <span class="search-hint">Search includes both local .vsix files and OpenVSX registry</span>
                            ${this._items.some(item => item.source === 'openvsx') ? 
								'<div class="remote-indicator"><span class="codicon codicon-cloud"></span> Showing remote extensions</div>' : ''}
                        </div>
                    </div>
                    
                    <div class="items-container">
                        ${this._getSortedItems().length === 0 ? `
                            <div class="empty-state">
                                <div class="codicon codicon-folder-opened"></div>
                                <div>No extensions found</div>
                                <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">
                                    Configure directories in settings or search OpenVSX registry
                                </div>
                            </div>
                        ` : this._getSortedItems().map(item => `
                            <div class="item ${item.isInstalled ? 'installed' : 'not-installed'} ${item.source === 'openvsx' ? 'remote-extension' : 'local-extension'} ${this._selectedExtensionId === item.id ? 'selected' : ''}" data-item-id="${item.id}" data-namespace="${item.namespace || ''}" tabindex="0">
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
                                    ${showSourceIndicators ? (item.source === 'openvsx' ? `
                                        <div class="source-badge remote-badge" title="OpenVSX Registry">
                                            <span class="codicon codicon-cloud"></span>
                                        </div>
                                    ` : `
                                        <div class="source-badge local-badge" title="Local Extension">
                                            <span class="codicon codicon-file"></span>
                                        </div>
                                    `) : ''}
                                    ${item.verified ? `
                                        <div class="verified-badge" title="Verified Publisher">
                                            <span class="codicon codicon-verified"></span>
                                        </div>
                                    ` : ''}
                                </div>
                                <div class="item-content">
                                    <!-- Row 1: Title -->
                                    <div class="item-header">
                                        <div class="item-title">
                                            ${item.title}
                                            ${item.deprecated ? '<span class="deprecated-tag">DEPRECATED</span>' : ''}
                                        </div>
                                        ${item.isInstalled ? `
                                            <div class="item-actions">
                                                <button class="action-btn toggle-status-btn" title="Toggle Status">
                                                    <span class="codicon codicon-circle-filled"></span>
                                                </button>
                                                ${item.source === 'local' ? `
                                                    <button class="action-btn delete-btn" title="Uninstall">
                                                        <span class="codicon codicon-trash"></span>
                                                    </button>
                                                ` : ''}
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
                                            ${item.source === 'openvsx' && showDownloadCount && item.downloadCount ? `
                                                <div class="download-info">
                                                    <span class="codicon codicon-cloud-download"></span>
                                                    <span class="download-count">${this.formatDownloadCount(item.downloadCount)}</span>
                                                </div>
                                            ` : ''}
                                            ${item.source === 'openvsx' && showRating && item.rating ? `
                                                <div class="rating-info">
                                                    <span class="codicon codicon-star-full"></span>
                                                    <span class="rating">${item.rating.toFixed(1)}</span>
                                                </div>
                                            ` : ''}
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
