import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { VsixParser, VsixPackageJson, VsixManifest } from './vsixParser';
import { OpenVSXClient, OpenVSXExtension } from './openVsxClient';

const readdir = promisify(fs.readdir);

export interface ExtensionInfo {
	id: string;
	title: string;
	description: string;
	version: string;
	author: string;
	publisher: string;
	icon?: string;
	filePath?: string;
	fileSize: number;
	lastModified: Date;
	isInstalled: boolean;
	hasUpdate?: boolean;
	categories?: string[];
	keywords?: string[];
	repository?: string;
	homepage?: string;
	license?: string;
	engines?: { [key: string]: string };
	activationEvents?: string[];
	main?: string;
	preview?: boolean;
	galleryBanner?: {
		color?: string;
		theme?: string;
	};
	tags?: string[];
	galleryFlags?: string[];
	targetPlatforms?: string[];
	language?: string;
	
	// Store parsed data for reuse
	packageJsonRaw?: VsixPackageJson;
	manifestRaw?: VsixManifest;
	readme?: string;
	changelog?: string;
	iconBuffer?: Buffer;

	// New properties for unified search
	source: 'local' | 'openvsx';
	namespace?: string;
	downloadCount?: number;
	rating?: number;
	reviewCount?: number;
	publishedDate?: string;
	verified?: boolean;
	deprecated?: boolean;
	replacementId?: string;
	openVsxData?: OpenVSXExtension;
}

export class StorageProvider {
	private _extensionCache: Map<string, ExtensionInfo> = new Map();
	private _watchers: fs.FSWatcher[] = [];
	private _onDidChangeEmitter = new vscode.EventEmitter<ExtensionInfo[]>();
	public readonly onDidChange = this._onDidChangeEmitter.event;
	private _isInitialized = false;
	private _initializationPromise?: Promise<void>;
	private _isRefreshing = false;
	private _initializationAttempted = false;
	
	// OpenVSX integration
	private _openVsxClient: OpenVSXClient;
	private _remoteExtensionCache: Map<string, ExtensionInfo> = new Map();
	private _lastRemoteSearch: string = '';
	private _remoteSearchResults: ExtensionInfo[] = [];

	constructor(private context: vscode.ExtensionContext) {
		console.log('StorageProvider: Constructor called');
		
		this._openVsxClient = new OpenVSXClient(context);
		this.initializeWatchers();

		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('privateExtensionsSidebar.vsixDirectories') ||
				e.affectsConfiguration('privateExtensionsSidebar.enableOpenVSX')) {
				console.log('StorageProvider: Configuration changed, refreshing...');
				this.refreshWatchers();
				if (this._isInitialized) {
					this.scanAllDirectories();
				}
			}
		});
	}

	/**
	 * Unified search that combines local and remote extensions
	 */
	public async searchExtensionsUnified(
		query: string,
		filters?: {
			category?: string;
			author?: string;
			installed?: boolean;
			hasUpdate?: boolean;
			source?: 'local' | 'openvsx' | 'all';
		}
	): Promise<ExtensionInfo[]> {
		const results: ExtensionInfo[] = [];
		
		// Always search local extensions
		if (!filters?.source || filters.source === 'local' || filters.source === 'all') {
			const localResults = this.searchExtensions(query, filters);
			results.push(...localResults);
		}

		// Search OpenVSX if enabled and query is meaningful
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const minLength = config.get<number>('remoteSearchMinLength', 3);
		
		if ((!filters?.source || filters.source === 'openvsx' || filters.source === 'all') && 
			query.trim().length >= minLength) {
			
			try {
				const remoteResults = await this.searchOpenVSXExtensions(query, filters);
				results.push(...remoteResults);
			} catch (error) {
				console.error('Error searching OpenVSX:', error);
				// Don't fail the entire search if remote search fails
			}
		}

		// Remove duplicates (prefer local versions)
		const uniqueResults = this.deduplicateUnifiedResults(results);
		
		// Sort results: installed first, then by relevance/popularity
		return this.sortUnifiedResults(uniqueResults, query);
	}

	/**
	 * Search OpenVSX extensions
	 */
	private async searchOpenVSXExtensions(
		query: string, 
		filters?: {
			category?: string;
			author?: string;
		}
	): Promise<ExtensionInfo[]> {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		if (!config.get<boolean>('enableOpenVSX', true)) {
			return [];
		}

		// Sanitize and validate query
		const cleanQuery = query.trim();
		if (cleanQuery.length === 0) {
			return [];
		}

		// Use cache for repeated searches
		if (config.get<boolean>('cacheRemoteResults', true) && 
			this._lastRemoteSearch === cleanQuery && this._remoteSearchResults.length > 0) {
			return this._remoteSearchResults.filter(ext => this.applyUnifiedFilters(ext, filters));
		}

		try {
			const maxResults = config.get<number>('maxRemoteResults', 50);
			
			// Build search parameters
			const searchParams: any = {
				query: cleanQuery,
				size: maxResults,
				sortBy: 'relevance'  // Changed from sortOrder to sortBy
			};

			// Add category filter if provided
			if (filters?.category && filters.category.trim().length > 0) {
				searchParams.category = filters.category.trim();
			}

			console.log('OpenVSX: Searching with params:', searchParams);
			const searchResult = await this._openVsxClient.searchExtensions(searchParams);

			if (!searchResult || !searchResult.extensions) {
				console.warn('OpenVSX: Invalid search result structure');
				return [];
			}

			const convertedResults = searchResult.extensions.map(ext => {
				const converted = this._openVsxClient.convertToUnifiedFormat(ext);
				
				// Check if locally installed
				converted.isInstalled = this.isExtensionInstalled(converted.id);
				
				// Check for updates if installed
				if (converted.isInstalled) {
					const installedExtension = vscode.extensions.getExtension(converted.id);
					if (installedExtension) {
						const installedVersion = installedExtension.packageJSON.version;
						converted.hasUpdate = this.compareVersions(converted.version, installedVersion) > 0;
					}
				}

				return converted as ExtensionInfo;
			});

			// Cache results
			if (config.get<boolean>('cacheRemoteResults', true)) {
				this._lastRemoteSearch = cleanQuery;
				this._remoteSearchResults = convertedResults;
			}
			
			// Cache individual extensions
			convertedResults.forEach(ext => {
				this._remoteExtensionCache.set(ext.id, ext);
			});

			console.log(`OpenVSX: Found ${convertedResults.length} extensions for query "${cleanQuery}"`);
			return convertedResults.filter(ext => this.applyUnifiedFilters(ext, filters));
		} catch (error) {
			console.error('Error searching OpenVSX:', error);
			return [];
		}
	}

	/**
	 * Apply filters to unified results
	 */
	private applyUnifiedFilters(
		ext: ExtensionInfo, 
		filters?: {
			category?: string;
			author?: string;
			installed?: boolean;
			hasUpdate?: boolean;
		}
	): boolean {
		if (filters?.category && (!ext.categories || !ext.categories.includes(filters.category))) {
			return false;
		}

		if (filters?.author && ext.author !== filters.author) {
			return false;
		}

		if (filters?.installed !== undefined && ext.isInstalled !== filters.installed) {
			return false;
		}

		if (filters?.hasUpdate !== undefined && ext.hasUpdate !== filters.hasUpdate) {
			return false;
		}

		return true;
	}

	/**
	 * Remove duplicates from unified results, preferring local versions
	 */
	private deduplicateUnifiedResults(results: ExtensionInfo[]): ExtensionInfo[] {
		const extensionMap = new Map<string, ExtensionInfo>();

		for (const ext of results) {
			const existing = extensionMap.get(ext.id);
			
			if (!existing) {
				extensionMap.set(ext.id, ext);
			} else {
				// Prefer local extensions
				if (ext.source === 'local' && existing.source === 'openvsx') {
					extensionMap.set(ext.id, ext);
				}
				// For same source, prefer higher version
				else if (ext.source === existing.source && 
						 this.compareVersions(ext.version, existing.version) > 0) {
					extensionMap.set(ext.id, ext);
				}
			}
		}

		return Array.from(extensionMap.values());
	}

	/**
	 * Sort unified results by relevance and status
	 */
	private sortUnifiedResults(results: ExtensionInfo[], query: string): ExtensionInfo[] {
		const queryLower = query.toLowerCase();
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const preferLocal = config.get<boolean>('preferLocalExtensions', true);
		
		return results.sort((a, b) => {
			// Priority 1: Installed extensions first
			if (a.isInstalled && !b.isInstalled) return -1;
			if (!a.isInstalled && b.isInstalled) return 1;

			// Priority 2: Extensions with updates
			if (a.hasUpdate && !b.hasUpdate) return -1;
			if (!a.hasUpdate && b.hasUpdate) return 1;

			// Priority 3: Local extensions over remote (if preference enabled)
			if (preferLocal && a.source !== b.source) {
				if (a.source === 'local' && b.source === 'openvsx') return -1;
				if (a.source === 'openvsx' && b.source === 'local') return 1;
			}

			// Priority 4: Exact title matches
			const aExactMatch = a.title.toLowerCase() === queryLower;
			const bExactMatch = b.title.toLowerCase() === queryLower;
			if (aExactMatch && !bExactMatch) return -1;
			if (!aExactMatch && bExactMatch) return 1;

			// Priority 5: Title starts with query
			const aTitleStarts = a.title.toLowerCase().startsWith(queryLower);
			const bTitleStarts = b.title.toLowerCase().startsWith(queryLower);
			if (aTitleStarts && !bTitleStarts) return -1;
			if (!aTitleStarts && bTitleStarts) return 1;

			// Priority 6: For remote extensions, sort by download count
			if (a.source === 'openvsx' && b.source === 'openvsx') {
				const aDownloads = a.downloadCount || 0;
				const bDownloads = b.downloadCount || 0;
				if (aDownloads !== bDownloads) {
					return bDownloads - aDownloads;
				}
			}

			// Final sort: alphabetical
			return a.title.localeCompare(b.title);
		});
	}

	/**
	 * Install extension from OpenVSX
	 */
	public async installOpenVSXExtension(extensionInfo: ExtensionInfo): Promise<boolean> {
		if (extensionInfo.source !== 'openvsx' || !extensionInfo.namespace) {
			throw new Error('Extension is not from OpenVSX');
		}

		try {
			// Show progress for download
			return await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Downloading ${extensionInfo.title}...`,
				cancellable: false
			}, async (progress) => {
				progress.report({ increment: 0, message: "Connecting to OpenVSX..." });

				// Download the extension
				const vsixPath = await this._openVsxClient.downloadExtension(
					extensionInfo.namespace!,
					extensionInfo.title,
					extensionInfo.version,
					undefined,
					(downloaded, total) => {
						const percentage = (downloaded / total) * 90; // Reserve 10% for installation
						progress.report({ 
							increment: percentage - ((progress as any).lastReported || 0),
							message: `Downloading... ${Math.round(percentage)}%`
						});
						(progress as any).lastReported = percentage;
					}
				);

				progress.report({ increment: 90, message: "Installing..." });

				// Install the downloaded VSIX
				await vscode.commands.executeCommand('workbench.extensions.installExtension',
					vscode.Uri.file(vsixPath));

				// Update extension status
				extensionInfo.isInstalled = true;
				extensionInfo.hasUpdate = false;
				
				// Add to local cache
				this._extensionCache.set(extensionInfo.id, extensionInfo);

				progress.report({ increment: 100, message: "Complete" });

				// Show success message
				vscode.window.showInformationMessage(`Successfully installed ${extensionInfo.title}`);

				// Trigger extension restart
				setTimeout(async () => {
					await this.handleExtensionRestart('install', extensionInfo.title);
				}, 1000);

				return true;
			});
		} catch (error) {
			console.error('Error installing OpenVSX extension:', error);
			vscode.window.showErrorMessage(`Failed to install ${extensionInfo.title}: ${error}`);
			return false;
		}
	}

	/**
	 * Get extension details for remote extensions
	 */
	public async getRemoteExtensionDetails(extensionId: string): Promise<ExtensionInfo | null> {
		// Check cache first
		if (this._remoteExtensionCache.has(extensionId)) {
			return this._remoteExtensionCache.get(extensionId)!;
		}

		// Parse extension ID (namespace.name)
		const [namespace, name] = extensionId.split('.');
		if (!namespace || name) {
			return null;
		}

		try {
			const openVsxExt = await this._openVsxClient.getExtension(namespace, name);
			const converted = this._openVsxClient.convertToUnifiedFormat(openVsxExt);
			
			// Check installation status
			converted.isInstalled = this.isExtensionInstalled(converted.id);
			if (converted.isInstalled) {
				const installedExtension = vscode.extensions.getExtension(converted.id);
				if (installedExtension) {
					const installedVersion = installedExtension.packageJSON.version;
					converted.hasUpdate = this.compareVersions(converted.version, installedVersion) > 0;
				}
			}

			// Get additional content
			try {
				const [readme, changelog] = await Promise.all([
					this._openVsxClient.getExtensionReadme(namespace, name),
					this._openVsxClient.getExtensionChangelog(namespace, name)
				]);
				
				converted.readme = readme || undefined;
				converted.changelog = changelog || undefined;
			} catch (error) {
				console.warn(`Error fetching additional content for ${extensionId}:`, error);
			}

			const result = converted as ExtensionInfo;
			
			// Cache the result
			this._remoteExtensionCache.set(extensionId, result);
			
			return result;
		} catch (error) {
			console.error(`Error getting remote extension details for ${extensionId}:`, error);
			return null;
		}
	}

	/**
	 * Clear remote extension cache
	 */
	public clearRemoteCache(): void {
		this._remoteExtensionCache.clear();
		this._lastRemoteSearch = '';
		this._remoteSearchResults = [];
		this._openVsxClient.clearCache();
	}

	/**
	 * Get popular extensions from OpenVSX
	 */
	public async getPopularExtensions(size: number = 20): Promise<ExtensionInfo[]> {
		try {
			const popular = await this._openVsxClient.getPopularExtensions(size);
			return popular.map(ext => {
				const converted = this._openVsxClient.convertToUnifiedFormat(ext);
				converted.isInstalled = this.isExtensionInstalled(converted.id);
				if (converted.isInstalled) {
					const installedExtension = vscode.extensions.getExtension(converted.id);
					if (installedExtension) {
						const installedVersion = installedExtension.packageJSON.version;
						converted.hasUpdate = this.compareVersions(converted.version, installedVersion) > 0;
					}
				}
				return converted as ExtensionInfo;
			});
		} catch (error) {
			console.error('Error getting popular extensions:', error);
			return [];
		}
	}

	/**
	 * Handle extension restart with user-configurable behavior
	 */
	private async handleExtensionRestart(operation: 'install' | 'update' | 'uninstall', extensionName: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const autoRestart = config.get<boolean>('autoRestartAfterInstall', false);
		const restartMethod = config.get<string>('restartMethod', 'prompt');

		if (autoRestart && restartMethod !== 'prompt') {
			const action = operation === 'install' ? 'installed' : operation === 'update' ? 'updated' : 'uninstalled';
			
			vscode.window.showInformationMessage(
				`${extensionName} ${action} successfully. Restarting extensions...`
			);
			
			setTimeout(async () => {
				try {
					if (restartMethod === 'extensionHost') {
						await vscode.commands.executeCommand('workbench.action.restartExtensionHost');
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

	// Original methods from the existing StorageProvider...

	/**
	 * Triggers VS Code to restart extensions
	 */
	private async triggerExtensionRestart(): Promise<void> {
		try {
			// Option 1: Use the reload window command (most reliable)
			const reloadChoice = await vscode.window.showInformationMessage(
				'Extension changes require reloading the window to take effect.',
				'Reload Window',
				'Later'
			);

			if (reloadChoice === 'Reload Window') {
				await vscode.commands.executeCommand('workbench.action.reloadWindow');
				return;
			}

			// Option 2: Alternative - restart extension host (if reload is declined)
			// This is less intrusive but may not work for all extensions
			try {
				await vscode.commands.executeCommand('workbench.action.restartExtensionHost');
				vscode.window.showInformationMessage('Extension host restarted successfully.');
			} catch (error) {
				console.warn('Extension host restart failed, suggesting manual reload:', error);
				vscode.window.showWarningMessage(
					'Please reload the window manually for changes to take effect.',
					'Reload Now'
				).then(choice => {
					if (choice === 'Reload Now') {
						vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				});
			}
		} catch (error) {
			console.error('Error triggering extension restart:', error);
			vscode.window.showWarningMessage(
				'Unable to restart extensions automatically. Please reload the window manually for changes to take effect.'
			);
		}
	}

	public async installExtension(extensionInfo: ExtensionInfo): Promise<boolean> {
		try {
			await vscode.commands.executeCommand('workbench.extensions.installExtension',
				vscode.Uri.file(extensionInfo.filePath!));

			extensionInfo.isInstalled = true;
			extensionInfo.hasUpdate = false;
			this._extensionCache.set(extensionInfo.id, extensionInfo);

			// Show success message first, before restart
			vscode.window.showInformationMessage(`Successfully installed ${extensionInfo.title}`);

			// Schedule scan after installation but before restart
			setTimeout(() => {
				this.scanAllDirectories();
			}, 500);

			// Trigger extension restart after a brief delay
			setTimeout(async () => {
				await this.handleExtensionRestart('install', extensionInfo.title);
			}, 1000);

			return true;
		} catch (error) {
			console.error('Error installing extension:', error);
			vscode.window.showErrorMessage(`Failed to install ${extensionInfo.title}: ${error}`);
			return false;
		}
	}

	public async uninstallExtension(extensionId: string): Promise<boolean> {
		try {
			const extension = vscode.extensions.getExtension(extensionId);
			if (!extension) {
				vscode.window.showWarningMessage('Extension not found or already uninstalled');
				return false;
			}

			const extensionName = extension.packageJSON.displayName || extension.packageJSON.name || extensionId;

			await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', extensionId);

			const cachedExtension = this._extensionCache.get(extensionId);
			if (cachedExtension) {
				cachedExtension.isInstalled = false;
				cachedExtension.hasUpdate = false;
				this._extensionCache.set(extensionId, cachedExtension);
			}

			// Show success message first, before restart
			vscode.window.showInformationMessage(`Successfully uninstalled extension`);

			// Schedule scan after uninstallation but before restart
			setTimeout(() => {
				this.scanAllDirectories();
			}, 500);

			// Trigger extension restart after a brief delay
			setTimeout(async () => {
				await this.handleExtensionRestart('uninstall', extensionName);
			}, 1000);

			return true;
		} catch (error) {
			console.error('Error uninstalling extension:', error);
			vscode.window.showErrorMessage(`Failed to uninstall extension: ${error}`);
			return false;
		}
	}

	private async initialize(): Promise<void> {
		console.log('StorageProvider: initialize() called, _isInitialized:', this._isInitialized, '_initializationAttempted:', this._initializationAttempted);
		
		if (this._isInitialized) {
			console.log('StorageProvider: Already initialized, returning');
			return;
		}

		if (this._initializationAttempted) {
			console.log('StorageProvider: Initialization already attempted, skipping');
			return;
		}

		this._initializationAttempted = true;
		console.log('StorageProvider: Starting initialization...');
		
		try {
			this._isInitialized = true;
			console.log('StorageProvider: Initialization complete (lazy loading)');
		} catch (error) {
			console.error('StorageProvider: Initialization failed:', error);
			this._isInitialized = true;
		}
	}

	private async ensureInitialized(): Promise<void> {
		console.log('StorageProvider: ensureInitialized() called, _isInitialized:', this._isInitialized);
		
		if (this._isInitialized) {
			console.log('StorageProvider: Already initialized, returning immediately');
			return;
		}

		if (this._initializationPromise) {
			console.log('StorageProvider: Waiting for existing initialization...');
			await this._initializationPromise;
			return;
		}

		console.log('StorageProvider: Starting new initialization...');
		this._initializationPromise = this.initialize();
		
		try {
			await this._initializationPromise;
		} finally {
			this._initializationPromise = undefined;
		}
	}

	public async getAllExtensions(): Promise<ExtensionInfo[]> {
		console.log('StorageProvider: getAllExtensions() called');
		
		if (!this._isInitialized) {
			console.log('StorageProvider: Not initialized, but proceeding with scan anyway');
		}
		
		const directories = this.getConfiguredDirectories();
		const extensions: ExtensionInfo[] = [];

		console.log(`StorageProvider: Scanning ${directories.length} directories...`);

		if (directories.length === 0) {
			console.log('StorageProvider: No directories configured, returning empty array');
			return extensions;
		}

		for (const directory of directories) {
			try {
				console.log(`StorageProvider: Scanning directory: ${directory}`);
				const dirExtensions = await this.scanDirectory(directory);
				extensions.push(...dirExtensions);
				console.log(`StorageProvider: Found ${dirExtensions.length} extensions in ${directory}`);
			} catch (error) {
				console.error(`StorageProvider: Error scanning directory ${directory}:`, error);
				vscode.window.showWarningMessage(`Failed to scan directory: ${directory}`);
			}
		}

		const uniqueExtensions = this.deduplicateExtensions(extensions);
		console.log(`StorageProvider: After deduplication: ${uniqueExtensions.length} unique extensions`);
		
		this.updateInstallationStatus(uniqueExtensions);
		console.log('StorageProvider: Installation status updated');

		console.log(`StorageProvider: getAllExtensions() returning ${uniqueExtensions.length} extensions`);
		return uniqueExtensions;
	}

	private updateInstallationStatus(extensions: ExtensionInfo[]): void {
		extensions.forEach(ext => {
			const wasInstalled = ext.isInstalled;
			ext.isInstalled = this.isExtensionInstalled(ext.id);
			
			if (ext.isInstalled) {
				const installedExtension = vscode.extensions.getExtension(ext.id);
				if (installedExtension) {
					const installedVersion = installedExtension.packageJSON.version;
					ext.hasUpdate = this.compareVersions(ext.version, installedVersion) > 0;
				}
			} else {
				ext.hasUpdate = false;
			}
		});
	}

	/**
	 * Get extension with all parsed data by ID
	 */
	public getExtensionById(id: string): ExtensionInfo | undefined {
		return this._extensionCache.get(id) || this._remoteExtensionCache.get(id);
	}

	/**
	 * Get detailed extension info (already parsed)
	 */
	public getExtensionDetails(extensionId: string): ExtensionInfo | null {
		const extension = this._extensionCache.get(extensionId) || this._remoteExtensionCache.get(extensionId);
		return extension || null;
	}

	public isExtensionInstalled(extensionId: string): boolean {
		const extension = vscode.extensions.getExtension(extensionId);
		return !!extension;
	}

	public async refresh(): Promise<ExtensionInfo[]> {
		console.log('StorageProvider: refresh() called');
		
		if (this._isRefreshing) {
			console.log('StorageProvider: Refresh already in progress, skipping...');
			return Array.from(this._extensionCache.values());
		}

		this._isRefreshing = true;
		
		try {
			console.log('StorageProvider: Starting refresh process...');
			
			await this.ensureInitialized();
			console.log('StorageProvider: Initialization ensured');
			
			this._extensionCache.clear();
			console.log('StorageProvider: Cache cleared, calling getAllExtensions...');
			
			const extensions = await this.getAllExtensions();
			console.log(`StorageProvider: getAllExtensions returned ${extensions.length} extensions`);

			extensions.forEach(ext => {
				this._extensionCache.set(ext.id, ext);
			});
			console.log('StorageProvider: Cache updated');

			console.log(`StorageProvider: Refresh complete, firing onDidChange with ${extensions.length} extensions`);
			
			setTimeout(() => {
				this._onDidChangeEmitter.fire(extensions);
			}, 0);
			
			return extensions;
		} catch (error) {
			console.error('StorageProvider: Error during refresh:', error);
			throw error;
		} finally {
			this._isRefreshing = false;
			console.log('StorageProvider: refresh() finally block - _isRefreshing set to false');
		}
	}

	public dispose(): void {
		console.log('StorageProvider: Disposing...');
		this._watchers.forEach(watcher => watcher.close());
		this._watchers = [];
		this._onDidChangeEmitter.dispose();
		this.clearRemoteCache();
	}

	// Original search method for local extensions
	public searchExtensions(
		query: string,
		filters?: {
			category?: string;
			author?: string;
			installed?: boolean;
			hasUpdate?: boolean;
		}
	): ExtensionInfo[] {
		const allExtensions = Array.from(this._extensionCache.values());
		const queryLower = query.toLowerCase();

		return allExtensions.filter(ext => {
			const matchesQuery = !query ||
				ext.title.toLowerCase().includes(queryLower) ||
				ext.description.toLowerCase().includes(queryLower) ||
				ext.author.toLowerCase().includes(queryLower) ||
				ext.publisher.toLowerCase().includes(queryLower) ||
				(ext.keywords && ext.keywords.some(keyword => keyword.toLowerCase().includes(queryLower))) ||
				(ext.tags && ext.tags.some(tag => tag.toLowerCase().includes(queryLower)));

			if (!matchesQuery) return false;

			if (filters) {
				if (filters.category && (!ext.categories || !ext.categories.includes(filters.category))) {
					return false;
				}

				if (filters.author && ext.author !== filters.author) {
					return false;
				}

				if (filters.installed !== undefined && ext.isInstalled !== filters.installed) {
					return false;
				}

				if (filters.hasUpdate !== undefined && ext.hasUpdate !== filters.hasUpdate) {
					return false;
				}
			}

			return true;
		});
	}

	// Continue with remaining original methods...
	private getConfiguredDirectories(): string[] {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const directories = config.get<string[]>('vsixDirectories', []);

		return directories.map(dir => {
			if (dir.startsWith('~')) {
				return path.join(require('os').homedir(), dir.slice(1));
			}
			return dir.replace(/\$\{(\w+)\}/g, (match, varName) => {
				return process.env[varName] || match;
			});
		}).filter(dir => {
			try {
				fs.accessSync(dir, fs.constants.R_OK);
				return true;
			} catch {
				console.warn(`StorageProvider: Directory not accessible: ${dir}`);
				return false;
			}
		});
	}

	private async scanDirectory(directory: string): Promise<ExtensionInfo[]> {
		const extensions: ExtensionInfo[] = [];

		try {
			const files = await readdir(directory);
			const vsixFiles = files.filter(file => path.extname(file).toLowerCase() === '.vsix');

			for (const file of vsixFiles) {
				const filePath = path.join(directory, file);
				try {
					const extensionInfo = await this.parseVsixFileComplete(filePath);
					if (extensionInfo) {
						extensions.push(extensionInfo);
					}
				} catch (error) {
					console.error(`StorageProvider: Error parsing ${filePath}:`, error);
				}
			}
		} catch (error) {
			console.error(`StorageProvider: Error reading directory ${directory}:`, error);
			throw error;
		}

		return extensions;
	}

	/**
	 * Complete VSIX parsing that extracts everything once
	 */
	private async parseVsixFileComplete(filePath: string): Promise<ExtensionInfo | null> {
		try {
			const parser = new VsixParser(filePath);
			const { packageJson, manifest, fileSize, lastModified } = await parser.parse();

			// Extract additional content during this single parse
			const readme = await parser.extractReadme();
			const changelog = await parser.extractChangelog();
			
			let iconPath: string | undefined;
			let iconBuffer: Buffer | undefined;
			const iconSource = packageJson?.icon || this.extractIconFromManifest(manifest);
			if (iconSource) {
				try {
					const extractedIcon = await parser.extractIcon(iconSource);
					if (extractedIcon) {
						iconBuffer = extractedIcon;
						const mimeType = VsixParser.getMimeTypeFromExtension(path.extname(iconSource));
						iconPath = `data:${mimeType};base64,${iconBuffer.toString('base64')}`;
					}
				} catch (error) {
					console.warn(`StorageProvider: Could not extract icon for ${filePath}:`, error);
				}
			}

			const extensionData = this.extractExtensionDataWithManifestPriority(manifest, packageJson);

			if (!extensionData.id || !extensionData.version || !extensionData.publisher) {
				console.warn(`StorageProvider: Missing required extension data for ${filePath}`);
				return null;
			}

			const isInstalled = this.isExtensionInstalled(extensionData.id);

			let hasUpdate = false;
			if (isInstalled) {
				const installedExtension = vscode.extensions.getExtension(extensionData.id);
				if (installedExtension) {
					const installedVersion = installedExtension.packageJSON.version;
					hasUpdate = this.compareVersions(extensionData.version, installedVersion) > 0;
				}
			}

			const extensionInfo: ExtensionInfo = {
				id: extensionData.id,
				title: extensionData.title,
				description: extensionData.description,
				version: extensionData.version,
				author: extensionData.author,
				publisher: extensionData.publisher,
				icon: iconPath,
				filePath,
				fileSize,
				lastModified,
				isInstalled,
				hasUpdate,
				categories: extensionData.categories,
				keywords: extensionData.keywords,
				repository: extensionData.repository,
				homepage: extensionData.homepage,
				license: extensionData.license,
				engines: extensionData.engines,
				activationEvents: extensionData.activationEvents,
				main: extensionData.main,
				preview: extensionData.preview,
				galleryBanner: extensionData.galleryBanner,
				tags: extensionData.tags,
				galleryFlags: extensionData.galleryFlags,
				targetPlatforms: extensionData.targetPlatforms,
				language: extensionData.language,
				
				// Store parsed data for reuse
				packageJsonRaw: packageJson || undefined,
				manifestRaw: manifest || undefined,
				readme: readme || undefined,
				changelog: changelog || undefined,
				iconBuffer: iconBuffer,

				// Mark as local extension
				source: 'local'
			};

			return extensionInfo;

		} catch (error) {
			console.error(`StorageProvider: Error parsing VSIX file ${filePath}:`, error);
			return null;
		}
	}

	// Continue with rest of original methods...
	private extractExtensionDataWithManifestPriority(
		manifest: VsixManifest | null,
		packageJson: VsixPackageJson | null
	): any {
		// Extract from manifest first
		let manifestData: any = {};
		if (manifest?.PackageManifest?.Metadata?.[0]) {
			const metadata = manifest.PackageManifest.Metadata[0];
			const identity = metadata.Identity?.[0]?.$;
			
			if (identity) {
				manifestData.id = `${identity.Publisher}.${identity.Id}`;
				manifestData.version = identity.Version;
				manifestData.publisher = identity.Publisher;
				manifestData.language = identity.Language;
			}

			manifestData.title = metadata.DisplayName?.[0] || identity?.Id;
			manifestData.description = metadata.Description?.[0]?._ || metadata.Description?.[0] || '';
			
			if (metadata.Categories?.[0]) {
				manifestData.categories = metadata.Categories[0].split(',').map((cat: string) => cat.trim());
			}

			if (metadata.Tags?.[0]) {
				manifestData.tags = metadata.Tags[0].split(',').map((tag: string) => tag.trim());
			}

			if (metadata.GalleryFlags?.[0]) {
				manifestData.galleryFlags = metadata.GalleryFlags[0].split(',').map((flag: string) => flag.trim());
			}

			if (metadata.Properties?.[0]?.Property) {
				const properties = metadata.Properties[0].Property;
				const propertyMap: { [key: string]: string } = {};
				
				properties.forEach((prop: any) => {
					if (prop.$ && prop.$.Id && prop.$.Value) {
						propertyMap[prop.$.Id] = prop.$.Value;
					}
				});

				if (propertyMap['Microsoft.VisualStudio.Code.Engine']) {
					manifestData.engines = { vscode: propertyMap['Microsoft.VisualStudio.Code.Engine'] };
				}
				if (propertyMap['Microsoft.VisualStudio.Services.Links.Source']) {
					manifestData.repository = propertyMap['Microsoft.VisualStudio.Services.Links.Source'];
				}
				if (propertyMap['Microsoft.VisualStudio.Services.Links.Getstarted']) {
					manifestData.homepage = propertyMap['Microsoft.VisualStudio.Services.Links.Getstarted'];
				}
				if (propertyMap['Microsoft.VisualStudio.Services.Links.License']) {
					manifestData.license = propertyMap['Microsoft.VisualStudio.Services.Links.License'];
				}
			}
		}

		if (manifest?.PackageManifest?.Installation?.[0]?.InstallationTarget) {
			const targets = manifest.PackageManifest.Installation[0].InstallationTarget;
			manifestData.targetPlatforms = targets.map((target: any) => target.$.Id);
		}

		let packageData: any = {};
		if (packageJson) {
			packageData = {
				id: packageJson.publisher && packageJson.name ? `${packageJson.publisher}.${packageJson.name}` : '',
				title: packageJson.displayName || packageJson.name,
				description: packageJson.description || '',
				version: packageJson.version,
				publisher: packageJson.publisher,
				categories: packageJson.categories,
				keywords: packageJson.keywords,
				engines: packageJson.engines,
				activationEvents: packageJson.activationEvents,
				main: packageJson.main,
				preview: packageJson.preview,
				galleryBanner: packageJson.galleryBanner,
				license: packageJson.license,
				homepage: packageJson.homepage
			};

			if (typeof packageJson.author === 'string') {
				packageData.author = packageJson.author;
			} else if (packageJson.author && typeof packageJson.author === 'object') {
				packageData.author = packageJson.author.name || 'Unknown';
			}

			if (typeof packageJson.repository === 'string') {
				packageData.repository = packageJson.repository;
			} else if (packageJson.repository && typeof packageJson.repository === 'object') {
				packageData.repository = packageJson.repository.url;
			}
		}

		const result = {
			id: manifestData.id || packageData.id || '',
			version: manifestData.version || packageData.version || '',
			publisher: manifestData.publisher || packageData.publisher || '',
			title: manifestData.title || packageData.title || '',
			description: manifestData.description || packageData.description || '',
			author: packageData.author || manifestData.publisher || 'Unknown',
			categories: manifestData.categories || packageData.categories,
			tags: manifestData.tags,
			engines: packageData.engines || manifestData.engines,
			activationEvents: packageData.activationEvents,
			main: packageData.main,
			preview: packageData.preview,
			galleryBanner: packageData.galleryBanner,
			repository: manifestData.repository || packageData.repository,
			homepage: manifestData.homepage || packageData.homepage,
			license: manifestData.license || packageData.license,
			keywords: packageData.keywords,
			galleryFlags: manifestData.galleryFlags,
			targetPlatforms: manifestData.targetPlatforms,
			language: manifestData.language
		};

		return result;
	}

	private extractIconFromManifest(manifest: VsixManifest | null): string | undefined {
		if (!manifest?.PackageManifest?.Assets?.[0]?.Asset) {
			return undefined;
		}

		const assets = manifest.PackageManifest.Assets[0].Asset;
		const iconAsset = assets.find((asset: any) => 
			asset.$.Type === 'Microsoft.VisualStudio.Services.Icons.Default' ||
			asset.$.Type === 'Microsoft.VisualStudio.Services.Icons.Small'
		);

		return iconAsset?.$.Path;
	}

	private deduplicateExtensions(extensions: ExtensionInfo[]): ExtensionInfo[] {
		const extensionMap = new Map<string, ExtensionInfo>();

		for (const ext of extensions) {
			const existing = extensionMap.get(ext.id);
			if (!existing || this.compareVersions(ext.version, existing.version) > 0) {
				extensionMap.set(ext.id, ext);
			}
		}

		return Array.from(extensionMap.values());
	}

	private compareVersions(version1: string, version2: string): number {
		const cleanVersion1 = version1.split('-')[0].split('+')[0];
		const cleanVersion2 = version2.split('-')[0].split('+')[0];

		const v1Parts = cleanVersion1.split('.').map(part => parseInt(part, 10) || 0);
		const v2Parts = cleanVersion2.split('.').map(part => parseInt(part, 10) || 0);

		const maxLength = Math.max(v1Parts.length, v2Parts.length);

		for (let i = 0; i < maxLength; i++) {
			const v1Part = v1Parts[i] || 0;
			const v2Part = v2Parts[i] || 0;

			if (v1Part > v2Part) return 1;
			if (v1Part < v2Part) return -1;
		}

		if (version1.includes('-') && !version2.includes('-')) return -1;
		if (!version1.includes('-') && version2.includes('-')) return 1;

		return 0;
	}

	private initializeWatchers(): void {
		this.refreshWatchers();
	}

	private refreshWatchers(): void {
		this._watchers.forEach(watcher => watcher.close());
		this._watchers = [];

		const directories = this.getConfiguredDirectories();

		directories.forEach(directory => {
			try {
				const watcher = fs.watch(directory, { persistent: false }, (eventType, filename) => {
					if (filename && path.extname(filename).toLowerCase() === '.vsix') {
						console.log(`StorageProvider: VSIX file ${eventType}: ${filename} in ${directory}`);
						this.debounceRefresh();
					}
				});

				watcher.on('error', (error) => {
					console.error(`StorageProvider: File watcher error for ${directory}:`, error);
				});

				this._watchers.push(watcher);
				console.log(`StorageProvider: Watching directory: ${directory}`);
			} catch (error) {
				console.error(`StorageProvider: Failed to watch directory ${directory}:`, error);
			}
		});
	}

	private refreshTimeout: NodeJS.Timeout | undefined;
	private debounceRefresh(): void {
		if (this.refreshTimeout) {
			clearTimeout(this.refreshTimeout);
		}

		this.refreshTimeout = setTimeout(() => {
			console.log('StorageProvider: Debounced refresh triggered by file watcher');
			this.scanAllDirectories();
		}, 2000);
	}

	private async scanAllDirectories(): Promise<void> {
		if (this._isRefreshing) {
			console.log('StorageProvider: Refresh in progress, skipping file watcher scan');
			return;
		}

		try {
			console.log('StorageProvider: Scanning all directories for changes...');
			const extensions = await this.getAllExtensions();

			this._extensionCache.clear();
			extensions.forEach(ext => {
				this._extensionCache.set(ext.id, ext);
			});

			console.log(`StorageProvider: Scan complete, found ${extensions.length} extensions total, firing onDidChange`);
			this._onDidChangeEmitter.fire(extensions);
		} catch (error) {
			console.error('StorageProvider: Error during directory scan:', error);
		}
	}

	public async validateVsixFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
		try {
			const parser = new VsixParser(filePath);
			const result = await parser.parse();

			const extractedData = this.extractExtensionDataWithManifestPriority(result.manifest, result.packageJson);

			if (!extractedData.id || !extractedData.version || !extractedData.publisher) {
				return { isValid: false, error: 'Missing required fields in extension metadata' };
			}

			return { isValid: true };
		} catch (error) {
			return { isValid: false, error: `Validation error: ${error}` };
		}
	}

	public getStatistics(): {
		total: number;
		installed: number;
		needsUpdate: number;
		byCategory: { [category: string]: number };
		byAuthor: { [author: string]: number };
		byTag: { [tag: string]: number };
		totalSize: number;
		remote: number;
		local: number;
	} {
		const allExtensions = [
			...Array.from(this._extensionCache.values()),
			...Array.from(this._remoteExtensionCache.values())
		];

		const stats = {
			total: allExtensions.length,
			installed: allExtensions.filter(ext => ext.isInstalled).length,
			needsUpdate: allExtensions.filter(ext => ext.hasUpdate).length,
			byCategory: {} as { [category: string]: number },
			byAuthor: {} as { [author: string]: number },
			byTag: {} as { [tag: string]: number },
			totalSize: allExtensions.reduce((sum, ext) => sum + (ext.fileSize || 0), 0),
			remote: allExtensions.filter(ext => ext.source === 'openvsx').length,
			local: allExtensions.filter(ext => ext.source === 'local').length
		};

		allExtensions.forEach(ext => {
			if (ext.categories) {
				ext.categories.forEach(category => {
					stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
				});
			}
		});

		allExtensions.forEach(ext => {
			stats.byAuthor[ext.author] = (stats.byAuthor[ext.author] || 0) + 1;
		});

		allExtensions.forEach(ext => {
			if (ext.tags) {
				ext.tags.forEach(tag => {
					stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;
				});
			}
		});

		return stats;
	}
}
