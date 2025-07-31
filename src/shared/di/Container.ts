import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';

interface ServiceDefinition {
	factory: () => any;
	singleton?: boolean;
	instance?: any;
}

export class Container {
	private services = new Map<string, ServiceDefinition>();
	private logger: Logger;

	constructor() {
		this.logger = new Logger('Container');
	}

	async initialize(context: vscode.ExtensionContext): Promise<void> {
		this.logger.info('Initializing dependency injection container');

		// Register core services
		await this.registerCoreServices(context);
		await this.registerInfrastructureServices(context);
		await this.registerApplicationServices();
		await this.registerPresentationServices(context);

		this.logger.info('Container initialization complete');
	}

	register<T>(name: string, factory: () => T, singleton: boolean = true): void {
		this.services.set(name, { factory, singleton });
	}

	get<T>(name: string): T {
		const service = this.services.get(name);
		if (!service) {
			throw new Error(`Service not found: ${name}`);
		}

		if (service.singleton) {
			if (!service.instance) {
				service.instance = service.factory();
			}
			return service.instance;
		}

		return service.factory();
	}

	private async registerCoreServices(context: vscode.ExtensionContext): Promise<void> {
		const { Configuration } = await import('../../config/Configuration');
		const { EventBus } = await import('../../core/application/events/EventBus');

		this.register('Configuration', () => new Configuration(context), true);
		this.register('EventBus', () => new EventBus(), true);
		this.register('Logger', () => new Logger('PrivateExtensionManager'), true);
	}

	private async registerInfrastructureServices(context: vscode.ExtensionContext): Promise<void> {
		const { ExtensionRepository } = await import('../../infrastructure/repositories/ExtensionRepository');
		const { VsixParser } = await import('../../infrastructure/parsers/VsixParser');
		const { DirectoryScanner } = await import('../../infrastructure/fileSystem/DirectoryScanner');
		const { CacheManager } = await import('../../infrastructure/cache/CacheManager');
		const { VSCodeExtensionManager } = await import('../../infrastructure/vscode/VSCodeExtensionManager');

		this.register('CacheManager', () => new CacheManager(), true);
		this.register('DirectoryScanner', () => new DirectoryScanner(this.get('Configuration')), true);
		this.register('VsixParser', () => new VsixParser(this.get('Logger')), true);
		this.register('VSCodeExtensionManager', () => new VSCodeExtensionManager(), true);

		this.register('ExtensionRepository', () => new ExtensionRepository(
			this.get('DirectoryScanner'),
			this.get('VsixParser'),
			this.get('CacheManager'),
			this.get('Logger')
		), true);
	}

	private async registerApplicationServices(): Promise<void> {
		const { ExtensionService } = await import('../../core/application/services/ExtensionService');
		const { InstallationService } = await import('../../core/application/services/InstallationService');
		const { SearchService } = await import('../../core/application/services/SearchService');

		// Use Cases
		const { InstallExtensionUseCase } = await import('../../core/application/useCases/InstallExtensionUseCase');
		const { UninstallExtensionUseCase } = await import('../../core/application/useCases/UninstallExtensionUseCase');
		const { SearchExtensionsUseCase } = await import('../../core/application/useCases/SearchExtensionsUseCase');
		const { RefreshExtensionsUseCase } = await import('../../core/application/useCases/RefreshExtensionsUseCase');

		// Services
		this.register('ExtensionService', () => new ExtensionService(
			this.get('ExtensionRepository'),
			this.get('EventBus')
		), true);

		this.register('InstallationService', () => new InstallationService(
			this.get('VSCodeExtensionManager'),
			this.get('EventBus'),
			this.get('Logger'),
			this.get('Configuration')
		), true);

		this.register('SearchService', () => new SearchService(
			this.get('ExtensionRepository')
		), true);

		// Use Cases
		this.register('InstallExtensionUseCase', () => new InstallExtensionUseCase(
			this.get('ExtensionService'),
			this.get('InstallationService'),
			this.get('EventBus')
		), true);

		this.register('UninstallExtensionUseCase', () => new UninstallExtensionUseCase(
			this.get('ExtensionService'),
			this.get('InstallationService'),
			this.get('EventBus')
		), true);

		this.register('SearchExtensionsUseCase', () => new SearchExtensionsUseCase(
			this.get('SearchService')
		), true);

		this.register('RefreshExtensionsUseCase', () => new RefreshExtensionsUseCase(
			this.get('ExtensionService'),
			this.get('EventBus')
		), true);
	}

	private async registerPresentationServices(context: vscode.ExtensionContext): Promise<void> {
		const { SidebarController } = await import('../../presentation/webview/controllers/SidebarController');
		const { DetailsController } = await import('../../presentation/webview/controllers/DetailsController');
		const { SidebarView } = await import('../../presentation/webview/views/SidebarView');
		const { DetailsView } = await import('../../presentation/webview/views/DetailsView');
		const { SidebarProvider } = await import('../../presentation/providers/SidebarProvider');
		const { CommandHandler } = await import('../../presentation/commands/CommandHandler');
		const { ErrorHandler } = await import('../../shared/errors/ErrorHandler');

		// Error Handler
		this.register('ErrorHandler', () => new ErrorHandler(this.get('Logger')), true);

		// Views
		this.register('DetailsView', () => new DetailsView(
			context.extensionUri,
			this.get('Logger')
		), true);

		this.register('SidebarView', () => new SidebarView(
			context.extensionUri,
			this.get('Logger')
		), true);

		// Controllers
		this.register('SidebarController', () => new SidebarController(
			this.get('ExtensionService'),
			this.get('InstallExtensionUseCase'),
			this.get('UninstallExtensionUseCase'),
			this.get('SearchExtensionsUseCase'),
			this.get('SidebarView'),
			this.get('EventBus'),
			this.get('Logger')
		), true);

		this.register('DetailsController', () => new DetailsController(
			this.get('ExtensionService'),
			this.get('InstallExtensionUseCase'),
			this.get('UninstallExtensionUseCase'),
			this.get('DetailsView'),
			this.get('EventBus'),
			this.get('Logger')
		), true);

		// Providers
		this.register('SidebarProvider', () => {
			const controller = this.get('SidebarController') as any;
			const provider = new SidebarProvider(controller, context.extensionUri);
			controller.setSidebarProvider(provider);
			return provider;
		}, true);

		// Commands
		this.register('CommandHandler', () => new CommandHandler(
			this.get('ExtensionService'),
			this.get('RefreshExtensionsUseCase'),
			this.get('Configuration'),
			this.get('Logger'),
			this.get('ErrorHandler')
		), true);
	}

	dispose(): void {
		this.logger.info('Disposing container');

		// Dispose all singleton instances that have a dispose method
		for (const [name, service] of this.services) {
			if (service.instance && typeof service.instance.dispose === 'function') {
				try {
					service.instance.dispose();
				} catch (error: any) {
					this.logger.warn(`Error disposing service ${name}`, { error });
				}
			}
		}

		this.services.clear();
	}
}
