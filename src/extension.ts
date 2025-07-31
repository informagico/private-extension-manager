import * as vscode from 'vscode';
import 'reflect-metadata';
import { Container } from './shared/di/Container';
import { ExtensionService } from './core/application/services/ExtensionService';
import { SidebarController } from './presentation/webview/controllers/SidebarController';
import { DetailsController } from './presentation/webview/controllers/DetailsController';
import { CommandHandler } from './presentation/commands/CommandHandler';
import { Logger } from './shared/utils/Logger';
import { Configuration } from './config/Configuration';

let container: Container;
let extensionService: ExtensionService;
let sidebarController: SidebarController;
let detailsController: DetailsController;
let commandHandler: CommandHandler;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const logger = new Logger('Extension');
	logger.info('Activating Private Extension Manager');

	try {
		// Initialize dependency injection container
		container = new Container();
		await container.initialize(context);

		// Make container globally accessible for webview communication
		(global as any).privateExtensionContainer = container;

		// Register core services
		extensionService = container.get<ExtensionService>('ExtensionService');
		sidebarController = container.get<SidebarController>('SidebarController');
		detailsController = container.get<DetailsController>('DetailsController');
		commandHandler = container.get<CommandHandler>('CommandHandler');

		// Register VS Code providers and commands
		await registerProviders(context);
		await registerCommands(context);

		// Initialize controllers
		await sidebarController.initialize();
		await detailsController.initialize();

		// Load extensions at startup if configured
		const config = container.get<Configuration>('Configuration');
		if (config.loadAtStartup) {
			await loadExtensionsAtStartup();
		}

		logger.info('Private Extension Manager activated successfully');
	} catch (error: any) {
		logger.error('Failed to activate extension', { error });
		vscode.window.showErrorMessage(`Failed to activate Private Extension Manager: ${error?.message || 'Unknown error'}`);
	}
}

async function registerProviders(context: vscode.ExtensionContext): Promise<void> {
	const sidebarProvider = container.get<vscode.WebviewViewProvider>('SidebarProvider');

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('privateExtensionsSidebar.sidebarView', sidebarProvider)
	);
}

async function registerCommands(context: vscode.ExtensionContext): Promise<void> {
	const commands = [
		'privateExtensionsSidebar.refresh',
		'privateExtensionsSidebar.addItem',
		'privateExtensionsSidebar.openSettings',
		'privateExtensionsSidebar.configureDirectories',
		'privateExtensionsSidebar.clearCache'
	];

	for (const command of commands) {
		context.subscriptions.push(
			vscode.commands.registerCommand(command, (...args) =>
				commandHandler.handleCommand(command, ...args)
			)
		);
	}
}

async function loadExtensionsAtStartup(): Promise<void> {
	const logger = new Logger('Startup');

	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Loading private extensions",
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0, message: "Scanning directories..." });

			const extensions = await extensionService.refreshExtensions();

			progress.report({ increment: 100, message: "Complete" });

			if (extensions.length > 0) {
				logger.info(`Loaded ${extensions.length} private extensions at startup`);
			}
		});
	} catch (error: any) {
		logger.error('Failed to load extensions at startup', { error });
		vscode.window.showWarningMessage(`Failed to load extensions: ${error?.message || 'Unknown error'}`);
	}
}

export function deactivate(): void {
	const logger = new Logger('Extension');
	logger.info('Deactivating Private Extension Manager');

	try {
		sidebarController?.dispose();
		detailsController?.dispose();
		commandHandler?.dispose();
		container?.dispose();

		// Clean up global reference
		delete (global as any).privateExtensionContainer;

		logger.info('Private Extension Manager deactivated successfully');
	} catch (error: any) {
		logger.error('Error during deactivation', { error });
	}
}
