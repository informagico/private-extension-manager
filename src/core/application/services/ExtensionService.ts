import { Injectable } from '../../../shared/decorators/Injectable';
import { IExtensionRepository } from '../../domain/interfaces/IExtensionRepository';
import { Extension } from '../../domain/entities/Extension';
import { ExtensionId } from '../../domain/valueObjects/ExtensionId';
import { SearchCriteria } from '../../../shared/types/ExtensionTypes';
import { EventBus } from '../events/EventBus';
import { ExtensionEvent } from '../events/ExtensionEvent';

@Injectable()
export class ExtensionService {
	constructor(
		private readonly repository: IExtensionRepository,
		private readonly eventBus: EventBus
	) { }

	async getAllExtensions(): Promise<Extension[]> {
		try {
			const extensions = await this.repository.findAll();
			this.eventBus.emit(new ExtensionEvent('extensions-loaded', { extensions }));
			return extensions;
		} catch (error) {
			this.eventBus.emit(new ExtensionEvent('extensions-load-failed', { error }));
			throw error;
		}
	}

	async getExtensionById(id: ExtensionId): Promise<Extension | null> {
		return await this.repository.findById(id);
	}

	async searchExtensions(criteria: SearchCriteria): Promise<Extension[]> {
		return await this.repository.search(criteria);
	}

	async refreshExtensions(): Promise<Extension[]> {
		this.eventBus.emit(new ExtensionEvent('refresh-started'));

		try {
			await this.repository.refresh();
			const extensions = await this.repository.findAll();

			this.eventBus.emit(new ExtensionEvent('refresh-completed', { extensions }));
			return extensions;
		} catch (error) {
			this.eventBus.emit(new ExtensionEvent('refresh-failed', { error }));
			throw error;
		}
	}

	async addDirectory(directoryPath: string): Promise<void> {
		await this.repository.addWatchedDirectory(directoryPath);
		this.eventBus.emit(new ExtensionEvent('directory-added', { directoryPath }));
	}

	async removeDirectory(directoryPath: string): Promise<void> {
		await this.repository.removeWatchedDirectory(directoryPath);
		this.eventBus.emit(new ExtensionEvent('directory-removed', { directoryPath }));
	}
}
