import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const mkdir = promisify(fs.mkdir);

export interface OpenVSXExtension {
	namespace: string;
	name: string;
	version: string;
	displayName?: string;
	description?: string;
	engines?: { [key: string]: string };
	categories?: string[];
	tags?: string[];
	license?: string;
	homepage?: string;
	repository?: string;
	bugs?: string;
	markdown?: string;
	galleryColor?: string;
	galleryTheme?: string;
	localizedLanguages?: string[];
	qna?: string;
	deprecated?: boolean;
	replacementId?: string;
	publishedBy?: {
		loginName: string;
		fullName?: string;
		avatarUrl?: string;
		homepage?: string;
	};
	allVersions?: {
		url: string;
		version: string;
		engines?: { [key: string]: string };
	}[];
	dependencies?: string[];
	bundledExtensions?: string[];
	files?: {
		download?: string;
		manifest?: string;
		readme?: string;
		license?: string;
		icon?: string;
		changelog?: string;
		repository?: string;
		bugs?: string;
		homepage?: string;
	};
	reviewCount?: number;
	reviewRating?: number;
	downloadCount?: number;
	publishedDate?: string;
	lastUpdated?: string;
	preview?: boolean;
	verified?: boolean;
	unrelatedPublisher?: boolean;
	namespaceAccess?: string;
	allTargetPlatforms?: string[];
	targetPlatform?: string;
}

export interface OpenVSXSearchResult {
	offset: number;
	totalSize: number;
	extensions: OpenVSXExtension[];
}

export interface OpenVSXSearchParams {
	query?: string;
	category?: string;
	size?: number;
	offset?: number;
	sortOrder?: 'relevance' | 'timestamp' | 'rating' | 'downloadCount';
	sortBy?: 'asc' | 'desc';
	includeAllVersions?: boolean;
}

export class OpenVSXClient {
	private static readonly BASE_URL = 'https://open-vsx.org/api';
	private readonly downloadCache = new Map<string, string>();
	private readonly config: vscode.WorkspaceConfiguration;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.config = vscode.workspace.getConfiguration('privateExtensionsSidebar');
	}

	/**
	 * Search for extensions on OpenVSX
	 */
	async searchExtensions(params: OpenVSXSearchParams = {}): Promise<OpenVSXSearchResult> {
		if (!this.config.get<boolean>('enableOpenVSX', true)) {
			return { offset: 0, totalSize: 0, extensions: [] };
		}

		const searchParams = new URLSearchParams();
		
		// Only add parameters if they have valid values
		if (params.query && params.query.trim().length > 0) {
			searchParams.append('query', params.query.trim());
		}
		
		if (params.category && params.category.trim().length > 0) {
			searchParams.append('category', params.category.trim());
		}
		
		if (params.size !== undefined && params.size > 0) {
			const maxResults = this.config.get<number>('maxRemoteResults', 50);
			searchParams.append('size', Math.min(params.size, maxResults).toString());
		} else {
			// Set default size if not provided
			const maxResults = this.config.get<number>('maxRemoteResults', 50);
			searchParams.append('size', Math.min(20, maxResults).toString());
		}
		
		if (params.offset !== undefined && params.offset >= 0) {
			searchParams.append('offset', params.offset.toString());
		}
		
		if (params.sortOrder && ['relevance', 'timestamp', 'rating', 'downloadCount'].includes(params.sortOrder)) {
			searchParams.append('sortOrder', params.sortOrder);
		}
		
		if (params.sortBy && ['asc', 'desc'].includes(params.sortBy)) {
			searchParams.append('sortBy', params.sortBy);
		}
		
		if (params.includeAllVersions === true) {
			searchParams.append('includeAllVersions', 'true');
		}

		const url = `${OpenVSXClient.BASE_URL}/-/search?${searchParams.toString()}`;
		
		try {
			console.log(`OpenVSX: Searching with URL: ${url}`);
			const response = await this.makeRequest(url);
			return JSON.parse(response) as OpenVSXSearchResult;
		} catch (error) {
			console.error('Error searching OpenVSX:', error);
			// Return empty result instead of throwing to prevent UI errors
			return { offset: 0, totalSize: 0, extensions: [] };
		}
	}

	/**
	 * Get detailed information about a specific extension
	 */
	async getExtension(namespace: string, name: string, version?: string): Promise<OpenVSXExtension> {
		let url = `${OpenVSXClient.BASE_URL}/${namespace}/${name}`;
		if (version) {
			url += `/${version}`;
		}

		try {
			const response = await this.makeRequest(url);
			return JSON.parse(response) as OpenVSXExtension;
		} catch (error) {
			console.error(`Error getting extension ${namespace}.${name}:`, error);
			throw new Error(`Failed to get extension details: ${error}`);
		}
	}

	/**
	 * Get README content for an extension
	 */
	async getExtensionReadme(namespace: string, name: string, version?: string): Promise<string | null> {
		try {
			const extension = await this.getExtension(namespace, name, version);
			if (extension.files?.readme) {
				return await this.makeRequest(extension.files.readme);
			}
			return null;
		} catch (error) {
			console.error(`Error getting README for ${namespace}.${name}:`, error);
			return null;
		}
	}

	/**
	 * Get changelog content for an extension
	 */
	async getExtensionChangelog(namespace: string, name: string, version?: string): Promise<string | null> {
		try {
			const extension = await this.getExtension(namespace, name, version);
			if (extension.files?.changelog) {
				return await this.makeRequest(extension.files.changelog);
			}
			return null;
		} catch (error) {
			console.error(`Error getting changelog for ${namespace}.${name}:`, error);
			return null;
		}
	}

	/**
	 * Download an extension from OpenVSX
	 */
	async downloadExtension(
		namespace: string,
		name: string,
		version?: string,
		targetPlatform?: string,
		progress?: (downloaded: number, total: number) => void
	): Promise<string> {
		const extensionId = `${namespace}.${name}${version ? `@${version}` : ''}${targetPlatform ? `@${targetPlatform}` : ''}`;

		// Check cache first
		if (this.downloadCache.has(extensionId)) {
			const cachedPath = this.downloadCache.get(extensionId)!;
			if (fs.existsSync(cachedPath)) {
				return cachedPath;
			} else {
				this.downloadCache.delete(extensionId);
			}
		}

		try {
			// Get extension details to find download URL
			let url = `${OpenVSXClient.BASE_URL}/${namespace}/${name}`;
			if (version) url += `/${version}`;
			if (targetPlatform) url += `/${targetPlatform}`;

			const extension = await this.getExtension(namespace, name, version);

			if (!extension.files?.download) {
				throw new Error('No download URL available for this extension');
			}

			// Create download directory
			const downloadDir = path.join(this.context.globalStorageUri.fsPath, 'downloads');
			await mkdir(downloadDir, { recursive: true });

			// Download the file
			const fileName = `${namespace}.${name}-${extension.version}.vsix`;
			const filePath = path.join(downloadDir, fileName);

			await this.downloadFile(extension.files.download, filePath, progress);

			// Cache the download path
			this.downloadCache.set(extensionId, filePath);

			return filePath;
		} catch (error) {
			console.error(`Error downloading extension ${namespace}.${name}:`, error);
			throw new Error(`Failed to download extension: ${error}`);
		}
	}

	/**
	 * Get popular extensions
	 */
	async getPopularExtensions(size: number = 20): Promise<OpenVSXExtension[]> {
		const result = await this.searchExtensions({
			size,
			sortOrder: 'downloadCount',
			sortBy: 'desc'
		});
		return result.extensions;
	}

	/**
	 * Get extensions by category
	 */
	async getExtensionsByCategory(category: string, size: number = 20): Promise<OpenVSXExtension[]> {
		const result = await this.searchExtensions({
			category,
			size,
			sortOrder: 'downloadCount',
			sortBy: 'desc'
		});
		return result.extensions;
	}

	/**
	 * Get available categories
	 */
	async getCategories(): Promise<string[]> {
		// Common VS Code extension categories based on OpenVSX
		return [
			'Programming Languages',
			'Snippets',
			'Linters',
			'Themes',
			'Debuggers',
			'Formatters',
			'Keymaps',
			'SCM Providers',
			'Extension Packs',
			'Education',
			'Data Science',
			'Machine Learning',
			'Visualization',
			'Testing',
			'Azure',
			'Other'
		];
	}

	/**
	 * Clear download cache
	 */
	clearCache(): void {
		this.downloadCache.clear();

		// Also clean up downloaded files older than configured duration
		try {
			const downloadDir = path.join(this.context.globalStorageUri.fsPath, 'downloads');
			if (fs.existsSync(downloadDir)) {
				const files = fs.readdirSync(downloadDir);
				const cacheDuration = this.config.get<number>('cacheDuration', 7);
				const cutoffTime = Date.now() - (cacheDuration * 24 * 60 * 60 * 1000);

				files.forEach(file => {
					const filePath = path.join(downloadDir, file);
					const stats = fs.statSync(filePath);
					if (stats.mtime.getTime() < cutoffTime) {
						fs.unlinkSync(filePath);
					}
				});
			}
		} catch (error) {
			console.warn('Error cleaning up download cache:', error);
		}
	}

	/**
	 * Convert OpenVSX extension to local extension format for unified display
	 */
	convertToUnifiedFormat(openVsxExt: OpenVSXExtension): any {
		return {
			id: `${openVsxExt.namespace}.${openVsxExt.name}`,
			title: openVsxExt.displayName || openVsxExt.name,
			description: openVsxExt.description || '',
			version: openVsxExt.version,
			author: openVsxExt.publishedBy?.fullName || openVsxExt.publishedBy?.loginName || openVsxExt.namespace,
			publisher: openVsxExt.namespace,
			icon: openVsxExt.files?.icon || null,
			categories: openVsxExt.categories || [],
			keywords: openVsxExt.tags || [],
			repository: openVsxExt.repository,
			homepage: openVsxExt.homepage,
			license: openVsxExt.license,
			engines: openVsxExt.engines,
			isInstalled: false,
			hasUpdate: false,
			downloadCount: openVsxExt.downloadCount || 0,
			rating: openVsxExt.reviewRating || 0,
			reviewCount: openVsxExt.reviewCount || 0,
			publishedDate: openVsxExt.publishedDate,
			lastUpdated: openVsxExt.lastUpdated,
			preview: openVsxExt.preview || false,
			verified: openVsxExt.verified || false,
			deprecated: openVsxExt.deprecated || false,
			replacementId: openVsxExt.replacementId,
			source: 'openvsx' as const,
			namespace: openVsxExt.namespace,
			openVsxData: openVsxExt,
			fileSize: 0,
			lastModified: new Date(openVsxExt.lastUpdated || openVsxExt.publishedDate || Date.now()),
			filePath: undefined
		};
	}

	/**
	 * Make HTTP request with timeout and error handling
	 */
	private makeRequest(url: string): Promise<string> {
		const timeout = this.config.get<number>('openVSXTimeout', 30) * 1000;
		
		return new Promise((resolve, reject) => {
			console.log(`OpenVSX: Making request to ${url}`);
			
			const request = https.get(url, {
				headers: {
					'User-Agent': 'Private-Extension-Manager/2.1.0',
					'Accept': 'application/json'
				}
			}, (response) => {
				console.log(`OpenVSX: Response status: ${response.statusCode}`);
				
				if (response.statusCode !== 200) {
					console.error(`OpenVSX: HTTP ${response.statusCode}: ${response.statusMessage}`);
					console.error(`OpenVSX: Request URL: ${url}`);
					reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
					return;
				}

				let data = '';
				response.on('data', chunk => data += chunk);
				response.on('end', () => {
					console.log(`OpenVSX: Received ${data.length} bytes`);
					resolve(data);
				});
			});

			request.on('error', (error) => {
				console.error('OpenVSX: Request error:', error);
				reject(error);
			});
			
			request.setTimeout(timeout, () => {
				console.error('OpenVSX: Request timeout');
				request.destroy();
				reject(new Error('Request timeout'));
			});
		});
	}

	/**
	 * Download file from URL with progress tracking
	 */
	private downloadFile(url: string, filePath: string, progress?: (downloaded: number, total: number) => void): Promise<void> {
		const timeout = this.config.get<number>('openVSXTimeout', 30) * 1000;

		return new Promise((resolve, reject) => {
			const file = fs.createWriteStream(filePath);

			const request = https.get(url, (response) => {
				if (response.statusCode !== 200) {
					file.close();
					fs.unlinkSync(filePath);
					reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
					return;
				}

				const totalSize = parseInt(response.headers['content-length'] || '0', 10);
				let downloadedSize = 0;

				response.on('data', (chunk) => {
					downloadedSize += chunk.length;
					if (progress && totalSize > 0) {
						progress(downloadedSize, totalSize);
					}
				});

				response.pipe(file);

				file.on('finish', () => {
					file.close();
					resolve();
				});

				file.on('error', (err) => {
					file.close();
					fs.unlinkSync(filePath);
					reject(err);
				});
			});

			request.on('error', (err) => {
				file.close();
				fs.unlinkSync(filePath);
				reject(err);
			});

			request.setTimeout(timeout, () => {
				request.destroy();
				file.close();
				fs.unlinkSync(filePath);
				reject(new Error('Download timeout'));
			});
		});
	}
}
