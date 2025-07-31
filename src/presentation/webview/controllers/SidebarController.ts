import { Injectable } from '../../../shared/decorators/Injectable';
import { ExtensionService } from '../../../core/application/services/ExtensionService';
import { InstallExtensionUseCase } from '../../../core/application/useCases/InstallExtensionUseCase';
import { UninstallExtensionUseCase } from '../../../core/application/useCases/UninstallExtensionUseCase';
import { SearchExtensionsUseCase } from '../../../core/application/useCases/SearchExtensionsUseCase';
import { SidebarView } from '../views/SidebarView';
import { ExtensionId } from '../../../core/domain/valueObjects/ExtensionId';
import { EventBus } from '../../../core/application/events/EventBus';
import { ExtensionEvent } from '../../../core/application/events/ExtensionEvent';
import { Logger } from '../../../shared/utils/Logger';
import { Debounce } from '../../../shared/decorators/Debounce';
import * as vscode from 'vscode';
import { Extension } from '../../../core/domain/entities/Extension';

@Injectable()
export class SidebarController {
	private selectedExtensionId?: ExtensionId;
	private sidebarProvider?: any;
	private webview?: vscode.Webview;

	constructor(
		private readonly extensionService: ExtensionService,
		private readonly installUseCase: InstallExtensionUseCase,
		private readonly uninstallUseCase: UninstallExtensionUseCase,
		private readonly searchUseCase: SearchExtensionsUseCase,
		private readonly view: SidebarView,
		private readonly eventBus: EventBus,
		private readonly logger: Logger
	) {
		this.setupEventListeners();
	}

	setWebview(webview: vscode.Webview): void {
		this.webview = webview;
		this.view.setWebview(webview);
	}

	async initialize(): Promise<void> {
		try {
			console.log('SidebarController: Starting initialization');
			await this.loadExtensions();
			console.log('SidebarController: Extensions loaded, calling render');
			this.view.render();
			console.log('SidebarController: Initialization complete');
		} catch (error: any) {
			console.error('SidebarController: Initialize failed', error);
			this.logger.error('Failed to initialize sidebar', { error });
			this.view.showError('Failed to load extensions');
		}
	}

	async handleRefresh(): Promise<void> {
		this.view.showLoading();

		try {
			await this.extensionService.refreshExtensions();
			this.view.hideLoading();
		} catch (error: any) {
			this.logger.error('Refresh failed', { error });
			this.view.showError('Failed to refresh extensions');
		}
	}

	async handleInstall(extensionId: string): Promise<void> {
		const id = new ExtensionId(extensionId);

		try {
			this.view.showInstallProgress(extensionId);
			const success = await this.installUseCase.execute(id);

			if (success) {
				this.view.showInstallSuccess(extensionId);
			} else {
				this.view.showInstallError(extensionId, 'Installation failed');
			}
		} catch (error: any) {
			this.logger.error('Install failed', { extensionId, error });
			this.view.showInstallError(extensionId, error?.message || 'Installation failed');
		}
	}

	async handleUninstall(extensionId: string): Promise<void> {
		const id = new ExtensionId(extensionId);

		try {
			this.view.showUninstallProgress(extensionId);
			const success = await this.uninstallUseCase.execute(id);

			if (success) {
				this.view.showUninstallSuccess(extensionId);
			} else {
				this.view.showUninstallError(extensionId, 'Uninstallation failed');
			}
		} catch (error: any) {
			this.logger.error('Uninstall failed', { extensionId, error });
			this.view.showUninstallError(extensionId, error?.message || 'Uninstallation failed');
		}
	}

	@Debounce(300)
	async handleSearch(query: string): Promise<void> {
		try {
			const results = await this.searchUseCase.execute({ query });
			this.view.updateExtensionList(results);
		} catch (error: any) {
			this.logger.error('Search failed', { query, error });
			this.view.showError('Search failed');
		}
	}

	handleExtensionSelect(extensionId: string): void {
		this.selectedExtensionId = new ExtensionId(extensionId);
		this.view.setSelectedExtension(extensionId);
		this.eventBus.emit(new ExtensionEvent('extension-selected', { extensionId }));
	}

	private setupEventListeners(): void {
		this.eventBus.subscribe('extensions-loaded', (event: any) => {
			const extensions = event.data?.extensions || [];
			this.view.updateExtensionList(extensions);
			this.refreshWebviewHtml(extensions);
		});

		this.eventBus.subscribe('refresh-started', () => {
			this.view.showLoading();
		});

		this.eventBus.subscribe('refresh-completed', (event: any) => {
			this.view.hideLoading();
			const extensions = event.data?.extensions || [];
			this.view.updateExtensionList(extensions);
			this.refreshWebviewHtml(extensions);
		});

		this.eventBus.subscribe('install-completed', (event: any) => {
			this.view.showInstallSuccess(event.data?.extension?.id?.value || '');
		});

		this.eventBus.subscribe('install-failed', (event: any) => {
			this.view.showInstallError(
				event.data?.extension?.id?.value || '',
				event.data?.error?.message || 'Installation failed'
			);
		});
	}

	setSidebarProvider(provider: any): void {
		this.sidebarProvider = provider;
	}

	private async loadExtensions(): Promise<void> {
		console.log('SidebarController: Loading extensions...');
		const extensions = await this.extensionService.getAllExtensions();
		console.log('SidebarController: Got extensions:', extensions.length);

		if (extensions.length > 0) {
			console.log('First extension:', {
				id: extensions[0].id.value,
				title: extensions[0].metadata.displayName,
				isInstalled: extensions[0].isInstalled
			});
		}

		this.view.updateExtensionList(extensions);

		if (this.sidebarProvider) {
			console.log('SidebarController: Updating provider with extensions');
			this.sidebarProvider.updateExtensions(extensions);
		} else {
			console.log('SidebarController: No sidebar provider set');
		}
	}

	private getHtmlForWebview(extensions: Extension[]): string {
		return this.sidebarProvider.getHtmlForWebview(extensions);
	}

	private refreshWebviewHtml(extensions: Extension[]): void {
		if (this.webview && this.sidebarProvider) {
			this.sidebarProvider.updateExtensions(extensions);
		}
	}

	dispose(): void {
		this.eventBus.unsubscribeAll();
	}
}
