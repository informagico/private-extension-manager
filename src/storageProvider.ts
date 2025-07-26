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
	
	// Store parsed data for reuse
	packageJsonRaw?: VsixPackageJson;
	manifestRaw?: VsixManifest;
	readme?: string;
	changelog?: string;
	iconBuffer?: Buffer;
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

	constructor(private context: vscode.ExtensionContext) {
		console.log('StorageProvider: Constructor called');
		
		this.initializeWatchers();

		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('privateExtensionsSidebar.vsixDirectories')) {
				console.log('StorageProvider: Configuration changed, refreshing...');
				this.refreshWatchers();
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
		return this._extensionCache.get(id);
	}

	/**
	 * Get detailed extension info (already parsed)
	 */
	public getExtensionDetails(extensionId: string): ExtensionInfo | null {
		const extension = this._extensionCache.get(extensionId);
		return extension || null;
	}

	public isExtensionInstalled(extensionId: string): boolean {
		const extension = vscode.extensions.getExtension(extensionId);
		return !!extension;
	}

	public async installExtension(extensionInfo: ExtensionInfo): Promise<boolean> {
		try {
			await vscode.commands.executeCommand('workbench.extensions.installExtension',
				vscode.Uri.file(extensionInfo.filePath));

			extensionInfo.isInstalled = true;
			extensionInfo.hasUpdate = false;
			this._extensionCache.set(extensionInfo.id, extensionInfo);

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

	public async uninstallExtension(extensionId: string): Promise<boolean> {
		try {
			const extension = vscode.extensions.getExtension(extensionId);
			if (!extension) {
				vscode.window.showWarningMessage('Extension not found or already uninstalled');
				return false;
			}

			await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', extensionId);

			const cachedExtension = this._extensionCache.get(extensionId);
			if (cachedExtension) {
				cachedExtension.isInstalled = false;
				cachedExtension.hasUpdate = false;
				this._extensionCache.set(extensionId, cachedExtension);
			}

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
	}

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
				iconBuffer: iconBuffer
			};

			return extensionInfo;

		} catch (error) {
			console.error(`StorageProvider: Error parsing VSIX file ${filePath}:`, error);
			return null;
		}
	}

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

		extensions.forEach(ext => {
			if (ext.categories) {
				ext.categories.forEach(category => {
					stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
				});
			}
		});

		extensions.forEach(ext => {
			stats.byAuthor[ext.author] = (stats.byAuthor[ext.author] || 0) + 1;
		});

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
