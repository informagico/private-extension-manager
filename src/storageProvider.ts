import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { VsixParser, VsixPackageJson, VsixManifest } from './vsixParser';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

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
}

export class StorageProvider {
	private _extensionCache: Map<string, ExtensionInfo> = new Map();
	private _watchers: fs.FSWatcher[] = [];
	private _onDidChangeEmitter = new vscode.EventEmitter<ExtensionInfo[]>();
	public readonly onDidChange = this._onDidChangeEmitter.event;

	constructor(private context: vscode.ExtensionContext) {
		this.initializeWatchers();

		// Watch for configuration changes
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('privateExtensionsSidebar.vsixDirectories')) {
				this.refreshWatchers();
				this.scanAllDirectories();
			}
		});
	}

	/**
	 * Get all extensions from configured directories
	 */
	public async getAllExtensions(): Promise<ExtensionInfo[]> {
		const directories = this.getConfiguredDirectories();
		const extensions: ExtensionInfo[] = [];

		for (const directory of directories) {
			try {
				const dirExtensions = await this.scanDirectory(directory);
				extensions.push(...dirExtensions);
			} catch (error) {
				console.error(`Error scanning directory ${directory}:`, error);
				vscode.window.showWarningMessage(`Failed to scan directory: ${directory}`);
			}
		}

		// Remove duplicates based on extension ID, keeping the most recent version
		const uniqueExtensions = this.deduplicateExtensions(extensions);

		return uniqueExtensions;
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

			// Update cache
			extensionInfo.isInstalled = true;
			this._extensionCache.set(extensionInfo.id, extensionInfo);

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

			// Update cache
			const cachedExtension = this._extensionCache.get(extensionId);
			if (cachedExtension) {
				cachedExtension.isInstalled = false;
				this._extensionCache.set(extensionId, cachedExtension);
			}

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
		this._extensionCache.clear();
		const extensions = await this.getAllExtensions();

		// Update cache
		extensions.forEach(ext => {
			this._extensionCache.set(ext.id, ext);
		});

		this._onDidChangeEmitter.fire(extensions);
		return extensions;
	}

	/**
	 * Dispose resources
	 */
	public dispose(): void {
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
				console.warn(`Directory not accessible: ${dir}`);
				return false;
			}
		});
	}

	private async scanDirectory(directory: string): Promise<ExtensionInfo[]> {
		const extensions: ExtensionInfo[] = [];

		try {
			const files = await readdir(directory);
			const vsixFiles = files.filter(file => path.extname(file).toLowerCase() === '.vsix');

			console.log(`Found ${vsixFiles.length} VSIX files in ${directory}`);

			for (const file of vsixFiles) {
				const filePath = path.join(directory, file);
				try {
					const extensionInfo = await this.parseVsixFile(filePath);
					if (extensionInfo) {
						extensions.push(extensionInfo);
					}
				} catch (error) {
					console.error(`Error parsing ${filePath}:`, error);
					// Continue with other files even if one fails
				}
			}
		} catch (error) {
			console.error(`Error reading directory ${directory}:`, error);
			throw error;
		}

		return extensions;
	}

	private async parseVsixFile(filePath: string): Promise<ExtensionInfo | null> {
		try {
			console.log(`Parsing VSIX file: ${filePath}`);

			const parser = new VsixParser(filePath);
			const { packageJson, manifest, fileSize, lastModified } = await parser.parse();

			if (!packageJson) {
				console.warn(`Could not parse package.json for ${filePath}`);
				return null;
			}

			// Create extension ID
			const extensionId = `${packageJson.publisher}.${packageJson.name}`;

			// Check if installed
			const isInstalled = this.isExtensionInstalled(extensionId);

			// Check for updates (compare versions if installed)
			let hasUpdate = false;
			if (isInstalled) {
				const installedExtension = vscode.extensions.getExtension(extensionId);
				if (installedExtension) {
					const installedVersion = installedExtension.packageJSON.version;
					hasUpdate = this.compareVersions(packageJson.version, installedVersion) > 0;
				}
			}

			// Extract icon if available
			let iconPath: string | undefined;
			if (packageJson.icon) {
				try {
					const iconBuffer = await parser.extractIcon(packageJson.icon);
					if (iconBuffer) {
						// Convert to data URI
						const mimeType = VsixParser.getMimeTypeFromExtension(path.extname(packageJson.icon));
						iconPath = `data:${mimeType};base64,${iconBuffer.toString('base64')}`;
					}
				} catch (error) {
					console.warn(`Could not extract icon for ${extensionId}:`, error);
				}
			}

			// Extract author information
			let authorName = 'Unknown';
			if (typeof packageJson.author === 'string') {
				authorName = packageJson.author;
			} else if (packageJson.author && typeof packageJson.author === 'object') {
				authorName = packageJson.author.name || 'Unknown';
			}

			// Extract repository URL
			let repositoryUrl: string | undefined;
			if (typeof packageJson.repository === 'string') {
				repositoryUrl = packageJson.repository;
			} else if (packageJson.repository && typeof packageJson.repository === 'object') {
				repositoryUrl = packageJson.repository.url;
			}

			const extensionInfo: ExtensionInfo = {
				id: extensionId,
				title: packageJson.displayName || packageJson.name,
				description: packageJson.description || '',
				version: packageJson.version,
				author: authorName,
				publisher: packageJson.publisher,
				icon: iconPath,
				filePath,
				fileSize,
				lastModified,
				isInstalled,
				hasUpdate,
				categories: packageJson.categories,
				keywords: packageJson.keywords,
				repository: repositoryUrl,
				homepage: packageJson.homepage,
				license: packageJson.license,
				engines: packageJson.engines,
				activationEvents: packageJson.activationEvents,
				main: packageJson.main,
				preview: packageJson.preview,
				galleryBanner: packageJson.galleryBanner
			};

			console.log(`Successfully parsed: ${extensionInfo.title} v${extensionInfo.version} by ${extensionInfo.author}`);
			return extensionInfo;

		} catch (error) {
			console.error(`Error parsing VSIX file ${filePath}:`, error);
			return null;
		}
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
						console.log(`VSIX file ${eventType}: ${filename} in ${directory}`);
						// Debounce the refresh to avoid multiple rapid calls
						this.debounceRefresh();
					}
				});

				watcher.on('error', (error) => {
					console.error(`File watcher error for ${directory}:`, error);
				});

				this._watchers.push(watcher);
				console.log(`Watching directory: ${directory}`);
			} catch (error) {
				console.error(`Failed to watch directory ${directory}:`, error);
			}
		});
	}

	private refreshTimeout: NodeJS.Timeout | undefined;
	private debounceRefresh(): void {
		if (this.refreshTimeout) {
			clearTimeout(this.refreshTimeout);
		}

		this.refreshTimeout = setTimeout(() => {
			console.log('Debounced refresh triggered');
			this.scanAllDirectories();
		}, 1000); // 1 second debounce
	}

	private async scanAllDirectories(): Promise<void> {
		try {
			console.log('Scanning all directories for changes...');
			const extensions = await this.getAllExtensions();

			// Update cache
			this._extensionCache.clear();
			extensions.forEach(ext => {
				this._extensionCache.set(ext.id, ext);
			});

			console.log(`Found ${extensions.length} extensions total`);
			this._onDidChangeEmitter.fire(extensions);
		} catch (error) {
			console.error('Error during directory scan:', error);
		}
	}

	/**
	 * Validate VSIX file integrity
	 */
	public async validateVsixFile(filePath: string): Promise<{ isValid: boolean; error?: string }> {
		try {
			const parser = new VsixParser(filePath);
			const result = await parser.parse();

			if (!result.packageJson) {
				return { isValid: false, error: 'Invalid or missing package.json' };
			}

			// Basic validation
			if (!result.packageJson.name || !result.packageJson.version || !result.packageJson.publisher) {
				return { isValid: false, error: 'Missing required fields in package.json' };
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
			console.error(`Error getting extension details for ${extensionId}:`, error);
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
				(ext.keywords && ext.keywords.some(keyword => keyword.toLowerCase().includes(queryLower)));

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
		totalSize: number;
	} {
		const extensions = Array.from(this._extensionCache.values());

		const stats = {
			total: extensions.length,
			installed: extensions.filter(ext => ext.isInstalled).length,
			needsUpdate: extensions.filter(ext => ext.hasUpdate).length,
			byCategory: {} as { [category: string]: number },
			byAuthor: {} as { [author: string]: number },
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

		return stats;
	}
}
