import { Injectable } from '../../shared/decorators/Injectable';
import { IExtensionRepository } from '../../core/domain/interfaces/IExtensionRepository';
import { Extension } from '../../core/domain/entities/Extension';
import { ExtensionId } from '../../core/domain/valueObjects/ExtensionId';
import { SearchCriteria } from '../../shared/types/ExtensionTypes';
import { CacheManager } from '../cache/CacheManager';
import { DirectoryScanner } from '../fileSystem/DirectoryScanner';
import { VsixParser } from '../parsers/VsixParser';
import { FileWatcher } from '../fileSystem/FileWatcher';
import { Logger } from '../../shared/utils/Logger';

@Injectable()
export class ExtensionRepository implements IExtensionRepository {
	private readonly cache: CacheManager<Extension>;
	private readonly logger: Logger;
	private fileWatcher?: FileWatcher;

	constructor(
		private readonly directoryScanner: DirectoryScanner,
		private readonly vsixParser: VsixParser,
		cacheManager: CacheManager<Extension>,
		logger: Logger
	) {
		this.cache = cacheManager;
		this.logger = logger;
	}

	async findAll(): Promise<Extension[]> {
		const cached = this.cache.getAll();
		if (cached.length > 0) {
			this.logger.debug('Returning cached extensions', { count: cached.length });
			return cached;
		}

		return await this.refresh();
	}

	async findById(id: ExtensionId): Promise<Extension | null> {
		const cached = this.cache.get(id.value);
		if (cached) {
			return cached;
		}

		// If not in cache, try to find in all extensions
		const extensions = await this.findAll();
		return extensions.find(ext => ext.id.equals(id)) || null;
	}

	async search(criteria: SearchCriteria): Promise<Extension[]> {
		const allExtensions = await this.findAll();

		return allExtensions.filter(extension => {
			if (criteria.query) {
				const query = criteria.query.toLowerCase();
				const matchesQuery =
					extension.metadata.displayName.toLowerCase().includes(query) ||
					extension.metadata.description.toLowerCase().includes(query) ||
					extension.metadata.author.toLowerCase().includes(query) ||
					extension.metadata.keywords?.some(keyword =>
						keyword.toLowerCase().includes(query)
					);

				if (!matchesQuery) return false;
			}

			if (criteria.category && !extension.metadata.categories?.includes(criteria.category)) {
				return false;
			}

			if (criteria.isInstalled !== undefined && extension.isInstalled !== criteria.isInstalled) {
				return false;
			}

			if (criteria.hasUpdate !== undefined && extension.hasUpdate !== criteria.hasUpdate) {
				return false;
			}

			return true;
		});
	}

	async refresh(): Promise<Extension[]> {
		this.logger.info('Starting extension refresh');

		try {
			const vsixFiles = await this.directoryScanner.scanAllDirectories();
			const extensions: Extension[] = [];

			for (const filePath of vsixFiles) {
				try {
					const extension = await this.vsixParser.parse(filePath);
					if (extension) {
						extensions.push(extension);
						this.cache.set(extension.id.value, extension);
					}
				} catch (error) {
					this.logger.warn('Failed to parse extension', { filePath, error });
				}
			}

			this.logger.info('Extension refresh completed', { count: extensions.length });
			return extensions;
		} catch (error) {
			this.logger.error('Extension refresh failed', { error });
			throw error;
		}
	}

	async addWatchedDirectory(directoryPath: string): Promise<void> {
		await this.directoryScanner.addDirectory(directoryPath);
		this.setupFileWatcher();
	}

	async removeWatchedDirectory(directoryPath: string): Promise<void> {
		await this.directoryScanner.removeDirectory(directoryPath);
	}

	private setupFileWatcher(): void {
		if (!this.fileWatcher) {
			this.fileWatcher = new FileWatcher(
				this.directoryScanner.getWatchedDirectories(),
				() => this.handleFileChange()
			);
		}
	}

	private async handleFileChange(): Promise<void> {
		this.logger.debug('File change detected, refreshing extensions');
		this.cache.clear();
		await this.refresh();
	}

	dispose(): void {
		this.fileWatcher?.dispose();
		this.cache.clear();
	}
}
