import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { Injectable } from '../../shared/decorators/Injectable';
import { Configuration } from '../../config/Configuration';
import { Logger } from '../../shared/utils/Logger';
import { FileSystemError } from '../../shared/errors/ExtensionError';
import { FilePath } from '../../core/domain/valueObjects/FilePath';

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

@Injectable()
export class DirectoryScanner {
	private watchedDirectories = new Set<string>();
	private logger: Logger;

	constructor(private readonly configuration: Configuration) {
		this.logger = new Logger('DirectoryScanner');
		this.initializeDirectories();
	}

	async scanAllDirectories(): Promise<FilePath[]> {
		const vsixFiles: FilePath[] = [];
		const directories = Array.from(this.watchedDirectories);

		this.logger.info(`Scanning ${directories.length} directories`);

		for (const directory of directories) {
			try {
				const files = await this.scanDirectory(directory);
				vsixFiles.push(...files);
			} catch (error) {
				this.logger.warn(`Failed to scan directory: ${directory}`, { error });
			}
		}

		this.logger.info(`Found ${vsixFiles.length} VSIX files`);
		return vsixFiles;
	}

	async scanDirectory(directoryPath: string): Promise<FilePath[]> {
		try {
			await this.validateDirectory(directoryPath);

			const files = await readdir(directoryPath);
			const vsixFiles: FilePath[] = [];

			for (const file of files) {
				if (path.extname(file).toLowerCase() === '.vsix') {
					const fullPath = path.join(directoryPath, file);
					try {
						await this.validateFile(fullPath);
						vsixFiles.push(new FilePath(fullPath));
					} catch (error) {
						this.logger.warn(`Invalid VSIX file: ${fullPath}`, { error });
					}
				}
			}

			return vsixFiles;
		} catch (error) {
			throw new FileSystemError(`Failed to scan directory: ${directoryPath}`, error as Error);
		}
	}

	async addDirectory(directoryPath: string): Promise<void> {
		const normalizedPath = path.resolve(directoryPath);

		try {
			await this.validateDirectory(normalizedPath);
			this.watchedDirectories.add(normalizedPath);

			// Update configuration
			const currentDirs = this.configuration.vsixDirectories;
			if (!currentDirs.includes(normalizedPath)) {
				await this.configuration.updateVsixDirectories([...currentDirs, normalizedPath]);
			}

			this.logger.info(`Added directory: ${normalizedPath}`);
		} catch (error) {
			throw new FileSystemError(`Failed to add directory: ${directoryPath}`, error as Error);
		}
	}

	async removeDirectory(directoryPath: string): Promise<void> {
		const normalizedPath = path.resolve(directoryPath);

		if (this.watchedDirectories.has(normalizedPath)) {
			this.watchedDirectories.delete(normalizedPath);

			// Update configuration
			const currentDirs = this.configuration.vsixDirectories;
			const updatedDirs = currentDirs.filter(dir => path.resolve(dir) !== normalizedPath);
			await this.configuration.updateVsixDirectories(updatedDirs);

			this.logger.info(`Removed directory: ${normalizedPath}`);
		}
	}

	getWatchedDirectories(): string[] {
		return Array.from(this.watchedDirectories);
	}

	private async validateDirectory(directoryPath: string): Promise<void> {
		try {
			await access(directoryPath, fs.constants.R_OK);
			const stats = await stat(directoryPath);

			if (!stats.isDirectory()) {
				throw new Error(`Path is not a directory: ${directoryPath}`);
			}
		} catch (error) {
			throw new FileSystemError(`Directory validation failed: ${directoryPath}`, error as Error);
		}
	}

	private async validateFile(filePath: string): Promise<void> {
		try {
			await access(filePath, fs.constants.R_OK);
			const stats = await stat(filePath);

			if (!stats.isFile()) {
				throw new Error(`Path is not a file: ${filePath}`);
			}

			if (stats.size === 0) {
				throw new Error(`File is empty: ${filePath}`);
			}
		} catch (error) {
			throw new FileSystemError(`File validation failed: ${filePath}`, error as Error);
		}
	}

	private initializeDirectories(): void {
		const directories = this.configuration.vsixDirectories;

		for (const directory of directories) {
			try {
				const normalizedPath = this.resolvePath(directory);
				this.watchedDirectories.add(normalizedPath);
			} catch (error) {
				this.logger.warn(`Failed to initialize directory: ${directory}`, { error });
			}
		}
	}

	private resolvePath(directoryPath: string): string {
		if (directoryPath.startsWith('~')) {
			return path.join(require('os').homedir(), directoryPath.slice(1));
		}

		// Replace environment variables
		return directoryPath.replace(/\$\{(\w+)\}/g, (match, varName) => {
			return process.env[varName] || match;
		});
	}
}
