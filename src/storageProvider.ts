import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { VsixParser, VsixPackageJson, VsixManifest } from './vsixParser';

const readdir = promisify(fs.readdir);

export interface ExtensionInfo {
	id: string;
	title: string;
	description: string;
	version: string;
	author: string;
	publisher: string;
	icon?: string;
	filePath: string;
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
}

export class StorageProvider {
	private _extensionCache: Map<string, ExtensionInfo> = new Map();
	private _watchers: fs.FSWatcher[] = [];
	private _onDidChangeEmitter = new vscode.EventEmitter<ExtensionInfo[]>();
	public readonly onDidChange = this._onDidChangeEmitter.event;
	private _isInitialized = false;
	private _initializationPromise?: Promise<void>;
	private _isRefreshing = false; // Prevent concurrent refreshes
	private _initializationAttempted = false; // Track if initialization was attempted

	constructor(private context: vscode.ExtensionContext) {
		console.log('StorageProvider: Constructor called');
		
		// Don't initialize immediately - wait for explicit calls
		this.initializeWatchers();

		// Watch for configuration changes
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('privateExtensionsSidebar.vsixDirectories')) {
				console.log('StorageProvider: Configuration changed, refreshing...');
				this.refreshWatchers();
				// Don't auto-scan on config change during startup
				if (this._isInitialized) {
					this.scanAllDirectories();
				}
			}
		});
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
			// Don't load extensions immediately - just mark as initialized
			// Extensions will be loaded on the first explicit refresh call
			this._isInitialized = true;
			console.log('StorageProvider: Initialization complete (lazy loading)');
		} catch (error) {
			console.error('StorageProvider: Initialization failed:', error);
			this._isInitialized = true; // Mark as initialized even on error to prevent retries
		}
	}

	/**
	 * Ensure the storage provider is initialized
	 */
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

	/**
	 * Get all extensions from configured directories
	 */
	public async getAllExtensions(): Promise<ExtensionInfo[]> {
		console.log('StorageProvider: getAllExtensions() called');
		
		// Don't call ensureInitialized here to avoid recursive initialization
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

		// Remove duplicates based on extension ID, keeping the most recent version
		const uniqueExtensions = this.deduplicateExtensions(extensions);
		console.log(`StorageProvider: After deduplication: ${uniqueExtensions.length} unique extensions`);
		
		// Update installation status for all extensions
		this.updateInstallationStatus(uniqueExtensions);
		console.log('StorageProvider: Installation status updated');

		console.log(`StorageProvider: getAllExtensions() returning ${uniqueExtensions.length} extensions`);
		return uniqueExtensions;
	}

	/**
	 * Update installation status for all extensions
	 */
	private updateInstallationStatus(extensions: ExtensionInfo[]): void {
		extensions.forEach(ext => {
			const wasInstalled = ext.isInstalled;
			ext.isInstalled = this.isExtensionInstalled(ext.id);
			
			// Check for updates if installed
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
	 * Get extension by ID
	 */
	public getExtensionById(id: string): ExtensionInfo | undefined {
		return this._extensionCache.get(id);
	}

	/**
	 * Check if an extension is installed in VS Code
	 */
	public isExtensionInstalled(extensionId: string): boolean {
		const extension = vscode.extensions.getExtension(extensionId);
		return !!extension;
	}

	/**
	 * Install extension from .vsix file
	 */
	public async installExtension(extensionInfo: ExtensionInfo): Promise<boolean> {
		try {
			await vscode.commands.executeCommand('workbench.extensions.installExtension',
				vscode.Uri.file(extensionInfo.filePath));

			// Update cache immediately
			extensionInfo.isInstalled = true;
			extensionInfo.hasUpdate = false;
			this._extensionCache.set(extensionInfo.id, extensionInfo);

			// Trigger refresh to update UI
			setTimeout(() => {
				this.scanAllDirectories();
			}, 1000);

			vscode.window.showInformationMessage(`Successfully installed ${extensionInfo.title}`);
			return true;
		} catch (error) {
			console.error('Error installing extension:', error);
			vscode.window.showErrorMessage(`Failed to install ${extensionInfo.title}: ${error}`);
			return false;
		}
	}

	/**
	 * Uninstall extension
	 */
	public async uninstallExtension(extensionId: string): Promise<boolean> {
		try {
			const extension = vscode.extensions.getExtension(extensionId);
			if (!extension) {
				vscode.window.showWarningMessage('Extension not found or already uninstalled');
				return false;
			}

			await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', extensionId);

			// Update cache immediately
			const cachedExtension = this._extensionCache.get(extensionId);
			if (cachedExtension) {
				cachedExtension.isInstalled = false;
				cachedExtension.hasUpdate = false;
				this._extensionCache.set(extensionId, cachedExtension);
			}

			// Trigger refresh to update UI
			setTimeout(() => {
				this.scanAllDirectories();
			}, 1000);

			vscode.window.showInformationMessage(`Successfully uninstalled extension`);
			return true;
		} catch (error) {
			console.error('Error uninstalling extension:', error);
			vscode.window.showErrorMessage(`Failed to uninstall extension: ${error}`);
			return false;
		}
	}

	/**
	 * Refresh all extensions from directories
	 */
	public async refresh(): Promise<ExtensionInfo[]> {
		console.log('StorageProvider: refresh() called');
		
		// Prevent multiple concurrent refreshes
		if (this._isRefreshing) {
			console.log('StorageProvider: Refresh already in progress, skipping...');
			return Array.from(this._extensionCache.values());
		}

		this._isRefreshing = true;
		
		try {
			console.log('StorageProvider: Starting refresh process...');
			
			// Ensure initialization only once, but don't make it block the refresh
			await this.ensureInitialized();
			console.log('StorageProvider: Initialization ensured');
			
			this._extensionCache.clear();
			console.log('StorageProvider: Cache cleared, calling getAllExtensions...');
			
			const extensions = await this.getAllExtensions();
			console.log(`StorageProvider: getAllExtensions returned ${extensions.length} extensions`);

			// Update cache
			extensions.forEach(ext => {
				this._extensionCache.set(ext.id, ext);
			});
			console.log('StorageProvider: Cache updated');

			console.log(`StorageProvider: Refresh complete, firing onDidChange with ${extensions.length} extensions`);
			
			// Use setTimeout to ensure the event is fired asynchronously
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

	/**
	 * Dispose resources
	 */
	public dispose(): void {
		console.log('StorageProvider: Disposing...');
		this._watchers.forEach(watcher => watcher.close());
		this._watchers = [];
		this._onDidChangeEmitter.dispose();
	}

	private getConfiguredDirectories(): string[] {
		const config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
		const directories = config.get<string[]>('vsixDirectories', []);

		// Expand home directory and environment variables
		return directories.map(dir => {
			if (dir.startsWith('~')) {
				return path.join(require('os').homedir(), dir.slice(1));
			}
			// Expand environment variables
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
					const extensionInfo = await this.parseVsixFile(filePath);
					if (extensionInfo) {
						extensions.push(extensionInfo);
					}
				} catch (error) {
					console.error(`StorageProvider: Error parsing ${filePath}:`, error);
					// Continue with other files even if one fails
				}
			}
		} catch (error) {
			console.error(`StorageProvider: Error reading directory ${directory}:`, error);
			throw error;
		}

		return extensions;
	}

	private async parseVsixFile(filePath: string): Promise<ExtensionInfo | null> {
		try {
			const parser = new VsixParser(filePath);
			const { packageJson, manifest, fileSize, lastModified } = await parser.parse();

			// Try to extract data from manifest first, fall back to package.json
			const extensionData = this.extractExtensionDataWithManifestPriority(manifest, packageJson);

			if (!extensionData.id || !extensionData.version || !extensionData.publisher) {
				console.warn(`StorageProvider: Missing required extension data for ${filePath}`);
				return null;
			}

			// Check if installed
			const isInstalled = this.isExtensionInstalled(extensionData.id);

			// Check for updates (compare versions if installed)
			let hasUpdate = false;
			if (isInstalled) {
				const installedExtension = vscode.extensions.getExtension(extensionData.id);
				if (installedExtension) {
					const installedVersion = installedExtension.packageJSON.version;
					hasUpdate = this.compareVersions(extensionData.version, installedVersion) > 0;
				}
			}

			// Extract icon if available
			let iconPath: string | undefined;
			const iconSource = packageJson?.icon || this.extractIconFromManifest(manifest);
			if (iconSource) {
				try {
					const iconBuffer = await parser.extractIcon(iconSource);
					if (iconBuffer) {
						// Convert to data URI
						const mimeType = VsixParser.getMimeTypeFromExtension(path.extname(iconSource));
						iconPath = `data:${mimeType};base64,${iconBuffer.toString('base64')}`;
					}
				} catch (error) {
					console.warn(`StorageProvider: Could not extract icon for ${extensionData.id}:`, error);
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
				language: extensionData.language
			};

			return extensionInfo;

		} catch (error) {
			console.error(`StorageProvider: Error parsing VSIX file ${filePath}:`, error);
			return null;
		}
	}

	/**
	 * Extract extension data prioritizing manifest over package.json
	 */
	private extractExtensionDataWithManifestPriority(
		manifest: VsixManifest | null,
		packageJson: VsixPackageJson | null
	): {
		id: string;
		title: string;
		description: string;
		version: string;
		author: string;
		publisher: string;
		categories?: string[];
		keywords?: string[];
		repository?: string;
		homepage?: string;
		license?: string;
		engines?: { [key: string]: string };
		activationEvents?: string[];
		main?: string;
		preview?: boolean;
		galleryBanner?: any;
		tags?: string[];
		galleryFlags?: string[];
		targetPlatforms?: string[];
		language?: string;
	} {
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
			
			// Parse categories from manifest
			if (metadata.Categories?.[0]) {
				manifestData.categories = metadata.Categories[0].split(',').map((cat: string) => cat.trim());
			}

			// Parse tags from manifest
			if (metadata.Tags?.[0]) {
				manifestData.tags = metadata.Tags[0].split(',').map((tag: string) => tag.trim());
			}

			// Parse gallery flags
			if (metadata.GalleryFlags?.[0]) {
				manifestData.galleryFlags = metadata.GalleryFlags[0].split(',').map((flag: string) => flag.trim());
			}

			// Extract properties
			if (metadata.Properties?.[0]?.Property) {
				const properties = metadata.Properties[0].Property;
				const propertyMap: { [key: string]: string } = {};
				
				properties.forEach((prop: any) => {
					if (prop.$ && prop.$.Id && prop.$.Value) {
						propertyMap[prop.$.Id] = prop.$.Value;
					}
				});

				// Map known properties
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

		// Extract target platforms from installation info
		if (manifest?.PackageManifest?.Installation?.[0]?.InstallationTarget) {
			const targets = manifest.PackageManifest.Installation[0].InstallationTarget;
			manifestData.targetPlatforms = targets.map((target: any) => target.$.Id);
		}

		// Package.json fallbacks and additional data
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

			// Extract author information
			if (typeof packageJson.author === 'string') {
				packageData.author = packageJson.author;
			} else if (packageJson.author && typeof packageJson.author === 'object') {
				packageData.author = packageJson.author.name || 'Unknown';
			}

			// Extract repository URL
			if (typeof packageJson.repository === 'string') {
				packageData.repository = packageJson.repository;
			} else if (packageJson.repository && typeof packageJson.repository === 'object') {
				packageData.repository = packageJson.repository.url;
			}
		}

		// Merge data with manifest taking priority
		const result = {
			// Core identity - manifest has priority
			id: manifestData.id || packageData.id || '',
			version: manifestData.version || packageData.version || '',
			publisher: manifestData.publisher || packageData.publisher || '',
			
			// Display info - manifest has priority for title/description
			title: manifestData.title || packageData.title || '',
			description: manifestData.description || packageData.description || '',
			
			// Author - package.json usually has better author info
			author: packageData.author || manifestData.publisher || 'Unknown',
			
			// Categories/Tags - manifest has priority
			categories: manifestData.categories || packageData.categories,
			tags: manifestData.tags,
			
			// Technical info - package.json has priority for these
			engines: packageData.engines || manifestData.engines,
			activationEvents: packageData.activationEvents,
			main: packageData.main,
			preview: packageData.preview,
			galleryBanner: packageData.galleryBanner,
			
			// Links - manifest has priority
			repository: manifestData.repository || packageData.repository,
			homepage: manifestData.homepage || packageData.homepage,
			license: manifestData.license || packageData.license,
			
			// Keywords - package.json has priority
			keywords: packageData.keywords,
			
			// Manifest-specific fields
			galleryFlags: manifestData.galleryFlags,
			targetPlatforms: manifestData.targetPlatforms,
			language: manifestData.language
		};

		return result;
	}

	/**
	 * Extract icon path from manifest
	 */
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
		// Handle pre-release versions and build metadata
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

		// If base versions are equal, check pre-release versions
		if (version1.includes('-') && !version2.includes('-')) return -1;
		if (!version1.includes('-') && version2.includes('-')) return 1;

		return 0;
	}

	private initializeWatchers(): void {
		this.refreshWatchers();
	}

	private refreshWatchers(): void {
		// Close existing watchers
		this._watchers.forEach(watcher => watcher.close());
		this._watchers = [];

		// Create new watchers for configured directories
		const directories = this.getConfiguredDirectories();

		directories.forEach(directory => {
			try {
				const watcher = fs.watch(directory, { persistent: false }, (eventType, filename) => {
					if (filename && path.extname(filename).toLowerCase() === '.vsix') {
						console.log(`StorageProvider: VSIX file ${eventType}: ${filename} in ${directory}`);
						// Debounce the refresh to avoid multiple rapid calls
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
		}, 2000); // Increased debounce time to 2 seconds to reduce frequency
	}

	private async scanAllDirectories(): Promise<void> {
		// Prevent multiple concurrent scans from file watchers
		if (this._isRefreshing) {
			console.log('StorageProvider: Refresh in progress, skipping file watcher scan');
			return;
		}

		try {
			console.log('StorageProvider: Scanning all directories for changes...');
			const extensions = await this.getAllExtensions();

			// Update cache
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

	/**
	 * Validate VSIX file integrity
	 */
	public async validateVsixFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
		try {
			const parser = new VsixParser(filePath);
			const result = await parser.parse();

			// Try manifest first, then package.json
			const extractedData = this.extractExtensionDataWithManifestPriority(result.manifest, result.packageJson);

			if (!extractedData.id || !extractedData.version || !extractedData.publisher) {
				return { isValid: false, error: 'Missing required fields in extension metadata' };
			}

			return { isValid: true };
		} catch (error) {
			return { isValid: false, error: `Validation error: ${error}` };
		}
	}

	/**
	 * Get detailed extension information
	 */
	public async getExtensionDetails(extensionId: string): Promise<ExtensionInfo & {
		manifestData?: any;
		packageJsonRaw?: VsixPackageJson;
		validationResult?: { isValid: boolean; error?: string };
	} | null> {
		const extension = this._extensionCache.get(extensionId);
		if (!extension) {
			return null;
		}

		try {
			const parser = new VsixParser(extension.filePath);
			const { packageJson, manifest } = await parser.parse();
			const validation = await this.validateVsixFile(extension.filePath);

			return {
				...extension,
				manifestData: manifest,
				packageJsonRaw: packageJson || undefined,
				validationResult: validation
			};
		} catch (error) {
			console.error(`StorageProvider: Error getting extension details for ${extensionId}:`, error);
			return extension;
		}
	}

	/**
	 * Search extensions by criteria
	 */
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
			// Text search
			const matchesQuery = !query ||
				ext.title.toLowerCase().includes(queryLower) ||
				ext.description.toLowerCase().includes(queryLower) ||
				ext.author.toLowerCase().includes(queryLower) ||
				ext.publisher.toLowerCase().includes(queryLower) ||
				(ext.keywords && ext.keywords.some(keyword => keyword.toLowerCase().includes(queryLower))) ||
				(ext.tags && ext.tags.some(tag => tag.toLowerCase().includes(queryLower)));

			if (!matchesQuery) return false;

			// Apply filters
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

	/**
	 * Get extensions statistics
	 */
	public getStatistics(): {
		total: number;
		installed: number;
		needsUpdate: number;
		byCategory: { [category: string]: number };
		byAuthor: { [author: string]: number };
		byTag: { [tag: string]: number };
		totalSize: number;
	} {
		const extensions = Array.from(this._extensionCache.values());

		const stats = {
			total: extensions.length,
			installed: extensions.filter(ext => ext.isInstalled).length,
			needsUpdate: extensions.filter(ext => ext.hasUpdate).length,
			byCategory: {} as { [category: string]: number },
			byAuthor: {} as { [author: string]: number },
			byTag: {} as { [tag: string]: number },
			totalSize: extensions.reduce((sum, ext) => sum + ext.fileSize, 0)
		};

		// Count by category
		extensions.forEach(ext => {
			if (ext.categories) {
				ext.categories.forEach(category => {
					stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
				});
			}
		});

		// Count by author
		extensions.forEach(ext => {
			stats.byAuthor[ext.author] = (stats.byAuthor[ext.author] || 0) + 1;
		});

		// Count by tag
		extensions.forEach(ext => {
			if (ext.tags) {
				ext.tags.forEach(tag => {
					stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;
				});
			}
		});

		return stats;
	}
}
