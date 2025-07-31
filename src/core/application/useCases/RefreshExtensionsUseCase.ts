import { Injectable } from '../../../shared/decorators/Injectable';
import { ExtensionService } from '../services/ExtensionService';
import { Extension } from '../../domain/entities/Extension';
import { EventBus } from '../events/EventBus';
import { ExtensionEvent } from '../events/ExtensionEvent';

@Injectable()
export class RefreshExtensionsUseCase {
	constructor(
		private readonly extensionService: ExtensionService,
		private readonly eventBus: EventBus
	) { }

	async execute(): Promise<Extension[]> {
		this.eventBus.emit(new ExtensionEvent('refresh-started'));

		try {
			const extensions = await this.extensionService.refreshExtensions();
			this.eventBus.emit(new ExtensionEvent('refresh-completed', { extensions }));
			return extensions;
		} catch (error) {
			this.eventBus.emit(new ExtensionEvent('refresh-failed', { error }));
			throw error;
		}
	}
}
