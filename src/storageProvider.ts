import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { getVsixInfo } from 'vsix-info';

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

		return extensions;
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
			return dir;
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

			for (const file of vsixFiles) {
				const filePath = path.join(directory, file);
				try {
					const extensionInfo = await this.parseVsixFile(filePath);
					if (extensionInfo) {
						extensions.push(extensionInfo);
					}
				} catch (error) {
					console.error(`Error parsing ${filePath}:`, error);
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
			// Get file stats
			const stats = await stat(filePath);

			// Parse VSIX using vsix-info
			const vsixInfo = await getVsixInfo(filePath);
			const packageInfo = await vsixInfo.getPackageJson();
			const manifest = await vsixInfo.getManifest();

			if (!packageInfo || !manifest) {
				console.warn(`Could not parse package info for ${filePath}`);
				return null;
			}

			// Create extension ID
			const extensionId = `${packageInfo.publisher}.${packageInfo.name}`;

			// Check if installed
			const isInstalled = this.isExtensionInstalled(extensionId);

			// Check for updates (compare versions if installed)
			let hasUpdate = false;
			if (isInstalled) {
				const installedExtension = vscode.extensions.getExtension(extensionId);
				if (installedExtension) {
					const installedVersion = installedExtension.packageJSON.version;
					hasUpdate = this.compareVersions(packageInfo.version, installedVersion) > 0;
				}
			}

			// Extract icon if available
			let iconPath: string | undefined;
			if (packageInfo.icon) {
				try {
					const iconBuffer = await vsixInfo.getFile(packageInfo.icon);
					if (iconBuffer) {
						// Convert to data URI
						const mimeType = this.getMimeTypeFromExtension(path.extname(packageInfo.icon));
						iconPath = `data:${mimeType};base64,${iconBuffer.toString('base64')}`;
					}
				} catch (error) {
					console.warn(`Could not extract icon for ${extensionId}:`, error);
				}
			}

			const extensionInfo: ExtensionInfo = {
				id: extensionId,
				title: packageInfo.displayName || packageInfo.name,
				description: packageInfo.description || '',
				version: packageInfo.version,
				author: packageInfo.author?.name || packageInfo.author || 'Unknown',
				publisher: packageInfo.publisher,
				icon: iconPath,
				filePath,
				fileSize: stats.size,
				lastModified: stats.mtime,
				isInstalled,
				hasUpdate,
				categories: packageInfo.categories,
				keywords: packageInfo.keywords,
				repository: typeof packageInfo.repository === 'string'
					? packageInfo.repository
					: packageInfo.repository?.url,
				homepage: packageInfo.homepage,
				license: packageInfo.license,
				engines: packageInfo.engines
			};

			return extensionInfo;

		} catch (error) {
			console.error(`Error parsing VSIX file ${filePath}:`, error);
			return null;
		}
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

	private getMimeTypeFromExtension(ext: string): string {
		const mimeTypes: { [key: string]: string } = {
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.gif': 'image/gif',
			'.svg': 'image/svg+xml',
			'.webp': 'image/webp'
		};

		return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
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
				const watcher = fs.watch(directory, (eventType, filename) => {
					if (filename && path.extname(filename).toLowerCase() === '.vsix') {
						// Debounce the refresh to avoid multiple rapid calls
						this.debounceRefresh();
					}
				});

				this._watchers.push(watcher);
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
			this.scanAllDirectories();
		}, 1000); // 1 second debounce
	}

	private async scanAllDirectories(): Promise<void> {
		try {
			const extensions = await this.getAllExtensions();

			// Update cache
			this._extensionCache.clear();
			extensions.forEach(ext => {
				this._extensionCache.set(ext.id, ext);
			});

			this._onDidChangeEmitter.fire(extensions);
		} catch (error) {
			console.error('Error during directory scan:', error);
		}
	}
}
