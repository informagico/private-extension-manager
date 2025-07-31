import { Injectable } from '../../../shared/decorators/Injectable';
import { ExtensionService } from '../services/ExtensionService';
import { InstallationService } from '../services/InstallationService';
import { ExtensionId } from '../../domain/valueObjects/ExtensionId';
import { EventBus } from '../events/EventBus';
import { ExtensionEvent } from '../events/ExtensionEvent';
import { InstallationError } from '../../../shared/errors/ExtensionError';

@Injectable()
export class UninstallExtensionUseCase {
	constructor(
		private readonly extensionService: ExtensionService,
		private readonly installationService: InstallationService,
		private readonly eventBus: EventBus
	) { }

	async execute(extensionId: ExtensionId): Promise<boolean> {
		const extension = await this.extensionService.getExtensionById(extensionId);

		if (!extension) {
			throw new InstallationError(`Extension not found: ${extensionId.value}`);
		}

		if (!extension.isInstalled) {
			throw new InstallationError(`Extension is not installed: ${extension.metadata.displayName}`);
		}

		this.eventBus.emit(new ExtensionEvent('uninstall-started', { extension }));

		try {
			const success = await this.installationService.uninstall(extension);

			if (success) {
				extension.markAsUninstalled();
				this.eventBus.emit(new ExtensionEvent('uninstall-completed', { extension }));
			} else {
				this.eventBus.emit(new ExtensionEvent('uninstall-failed', { extension }));
			}

			return success;
		} catch (error) {
			this.eventBus.emit(new ExtensionEvent('uninstall-failed', { extension, error }));
			throw error;
		}
	}
}
