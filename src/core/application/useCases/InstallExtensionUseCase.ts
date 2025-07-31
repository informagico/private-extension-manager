import { Injectable } from '../../../shared/decorators/Injectable';
import { IExtensionRepository } from '../../domain/interfaces/IExtensionRepository';
import { ExtensionService } from '../services/ExtensionService';
import { InstallationService } from '../services/InstallationService';
import { ExtensionId } from '../../domain/valueObjects/ExtensionId';
import { EventBus } from '../events/EventBus';
import { ExtensionEvent } from '../events/ExtensionEvent';
import { Retry } from '../../../shared/decorators/Retry';

@Injectable()
export class InstallExtensionUseCase {
	constructor(
		private readonly extensionService: ExtensionService,
		private readonly installationService: InstallationService,
		private readonly eventBus: EventBus
	) { }

	@Retry(3, 1000)
	async execute(extensionId: ExtensionId): Promise<boolean> {
		const extension = await this.extensionService.getExtensionById(extensionId);

		if (!extension) {
			throw new Error(`Extension not found: ${extensionId.value}`);
		}

		if (extension.isInstalled && !extension.hasUpdate) {
			throw new Error(`Extension already installed: ${extension.metadata.displayName}`);
		}

		this.eventBus.emit(new ExtensionEvent('install-started', { extension }));

		try {
			const success = await this.installationService.install(extension);

			if (success) {
				extension.markAsInstalled();
				this.eventBus.emit(new ExtensionEvent('install-completed', { extension }));
			} else {
				this.eventBus.emit(new ExtensionEvent('install-failed', { extension }));
			}

			return success;
		} catch (error) {
			this.eventBus.emit(new ExtensionEvent('install-failed', { extension, error }));
			throw error;
		}
	}
}
