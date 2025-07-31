import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '../../shared/decorators/Injectable';
import { IFileWatcher } from '../../core/domain/interfaces/IFileWatcher';
import { Logger } from '../../shared/utils/Logger';
import { Debounce } from '../../shared/decorators/Debounce';

@Injectable()
export class FileWatcher implements IFileWatcher {
	private watchers = new Map<string, fs.FSWatcher>();
	private changeCallbacks: Array<(eventType: string, filePath: string) => void> = [];
	private isStarted = false;
	private logger: Logger;

	constructor(
		private watchedDirectories: string[] = [],
		onChange?: (eventType: string, filePath: string) => void
	) {
		this.logger = new Logger('FileWatcher');
		if (onChange) {
			this.onFileChange(onChange);
		}
	}

	start(): void {
		if (this.isStarted) {
			return;
		}

		this.logger.info(`Starting file watcher for ${this.watchedDirectories.length} directories`);

		for (const directory of this.watchedDirectories) {
			this.addDirectory(directory);
		}

		this.isStarted = true;
	}

	stop(): void {
		if (!this.isStarted) {
			return;
		}

		this.logger.info('Stopping file watcher');

		for (const [directory, watcher] of this.watchers) {
			watcher.close();
			this.logger.debug(`Stopped watching: ${directory}`);
		}

		this.watchers.clear();
		this.isStarted = false;
	}

	addDirectory(directoryPath: string): void {
		const normalizedPath = path.resolve(directoryPath);

		if (this.watchers.has(normalizedPath)) {
			this.logger.debug(`Already watching: ${normalizedPath}`);
			return;
		}

		try {
			// Verify directory exists and is accessible
			fs.accessSync(normalizedPath, fs.constants.R_OK);

			const watcher = fs.watch(normalizedPath, { persistent: false }, (eventType, filename) => {
				if (filename && path.extname(filename).toLowerCase() === '.vsix') {
					const fullPath = path.join(normalizedPath, filename);
					this.handleFileChange(eventType, fullPath);
				}
			});

			watcher.on('error', (error) => {
				this.logger.error(`File watcher error for ${normalizedPath}:`, { error });
				this.watchers.delete(normalizedPath);
			});

			this.watchers.set(normalizedPath, watcher);
			this.logger.debug(`Started watching: ${normalizedPath}`);

		} catch (error) {
			this.logger.warn(`Failed to watch directory: ${normalizedPath}`, { error });
		}
	}

	removeDirectory(directoryPath: string): void {
		const normalizedPath = path.resolve(directoryPath);
		const watcher = this.watchers.get(normalizedPath);

		if (watcher) {
			watcher.close();
			this.watchers.delete(normalizedPath);
			this.logger.debug(`Stopped watching: ${normalizedPath}`);
		}
	}

	onFileChange(callback: (eventType: string, filePath: string) => void): void {
		this.changeCallbacks.push(callback);
	}

	@Debounce(2000) // Debounce file changes by 2 seconds
	private handleFileChange(eventType: string, filePath: string): void {
		this.logger.debug(`File change detected: ${eventType} - ${filePath}`);

		for (const callback of this.changeCallbacks) {
			try {
				callback(eventType, filePath);
			} catch (error) {
				this.logger.error('Error in file change callback:', { error });
			}
		}
	}

	dispose(): void {
		this.stop();
		this.changeCallbacks = [];
	}
}
