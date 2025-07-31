import { Injectable } from '../../../shared/decorators/Injectable';
import { ExtensionService } from '../../../core/application/services/ExtensionService';
import { InstallExtensionUseCase } from '../../../core/application/useCases/InstallExtensionUseCase';
import { UninstallExtensionUseCase } from '../../../core/application/useCases/UninstallExtensionUseCase';
import { DetailsView } from '../views/DetailsView';
import { ExtensionId } from '../../../core/domain/valueObjects/ExtensionId';
import { EventBus } from '../../../core/application/events/EventBus';
import { ExtensionEvent } from '../../../core/application/events/ExtensionEvent';
import { Logger } from '../../../shared/utils/Logger';

@Injectable()
export class DetailsController {
	constructor(
		private readonly extensionService: ExtensionService,
		private readonly installUseCase: InstallExtensionUseCase,
		private readonly uninstallUseCase: UninstallExtensionUseCase,
		private readonly view: DetailsView,
		private readonly eventBus: EventBus,
		private readonly logger: Logger
	) {
		this.setupEventListeners();
	}

	async initialize(): Promise<void> {
		this.logger.info('Initializing DetailsController');
	}

	async showExtensionDetails(filePath: string): Promise<void> {
		const extensions = await this.extensionService.getAllExtensions();
		const extension = extensions.find(ext => ext.filePath.value === filePath);

		if (extension) {
			await this.view.showExtensionDetails(extension);
		}
	}

	private setupEventListeners(): void {
		this.eventBus.subscribe('extensions-loaded', (event: any) => {
			this.view.updateOpenPanels(event.data.extensions);
		});
	}

	dispose(): void {
		this.view.dispose();
		this.eventBus.unsubscribeAll();
	}
}
