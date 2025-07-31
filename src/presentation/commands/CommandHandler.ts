import { Injectable } from '../../shared/decorators/Injectable';
import { ExtensionService } from '../../core/application/services/ExtensionService';
import { RefreshExtensionsUseCase } from '../../core/application/useCases/RefreshExtensionsUseCase';
import { Configuration } from '../../config/Configuration';
import { Logger } from '../../shared/utils/Logger';
import { ErrorHandler } from '../../shared/errors/ErrorHandler';
import * as vscode from 'vscode';

@Injectable()
export class CommandHandler {
	constructor(
		private readonly extensionService: ExtensionService,
		private readonly refreshUseCase: RefreshExtensionsUseCase,
		private readonly configuration: Configuration,
		private readonly logger: Logger,
		private readonly errorHandler: ErrorHandler
	) { }

	async handleCommand(command: string, ...args: any[]): Promise<void> {
		this.logger.debug(`Handling command: ${command}`, { args });

		try {
			switch (command) {
				case 'privateExtensionsSidebar.refresh':
					await this.handleRefresh();
					break;
				case 'privateExtensionsSidebar.addItem':
					await this.handleAddDirectory();
					break;
				case 'privateExtensionsSidebar.openSettings':
					await this.handleOpenSettings();
					break;
				case 'privateExtensionsSidebar.configureDirectories':
					await this.handleConfigureDirectories();
					break;
				case 'privateExtensionsSidebar.clearCache':
					await this.handleClearCache();
					break;
				default:
					this.logger.warn(`Unknown command: ${command}`);
					vscode.window.showWarningMessage(`Unknown command: ${command}`);
			}
		} catch (error) {
			this.errorHandler.handle(error as Error, `Command: ${command}`);
		}
	}

	private async handleRefresh(): Promise<void> {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Refreshing extensions...",
			cancellable: false
		}, async (progress) => {
			progress.report({ increment: 0 });

			const extensions = await this.refreshUseCase.execute();

			progress.report({ increment: 100 });

			vscode.window.showInformationMessage(
				`Refreshed ${extensions.length} extension${extensions.length === 1 ? '' : 's'}`
			);
		});
	}

	private async handleAddDirectory(): Promise<void> {
		const options: vscode.OpenDialogOptions = {
			canSelectMany: true,
			canSelectFiles: false,
			canSelectFolders: true,
			openLabel: 'Select VSIX Directories'
		};

		const folderUris = await vscode.window.showOpenDialog(options);
		if (!folderUris || folderUris.length === 0) {
			return;
		}

		const newDirectories = folderUris.map(uri => uri.fsPath);

		for (const directory of newDirectories) {
			await this.extensionService.addDirectory(directory);
		}

		vscode.window.showInformationMessage(
			`Added ${newDirectories.length} director${newDirectories.length === 1 ? 'y' : 'ies'}`
		);
	}

	private async handleOpenSettings(): Promise<void> {
		await vscode.commands.executeCommand(
			'workbench.action.openSettings',
			'privateExtensionsSidebar'
		);
	}

	private async handleConfigureDirectories(): Promise<void> {
		const currentDirs = this.configuration.vsixDirectories;

		const result = await vscode.window.showInputBox({
			prompt: 'Enter directory paths separated by commas',
			value: currentDirs.join(', '),
			placeHolder: '~/extensions, /path/to/extensions, C:\\Extensions',
			validateInput: (value) => {
				if (!value.trim()) {
					return 'Please enter at least one directory path';
				}
				return null;
			}
		});

		if (result !== undefined) {
			const newDirs = result.split(',')
				.map(dir => dir.trim())
				.filter(dir => dir.length > 0);

			await this.configuration.updateVsixDirectories(newDirs);

			vscode.window.showInformationMessage(
				`Updated VSIX directories. Found ${newDirs.length} director${newDirs.length === 1 ? 'y' : 'ies'}.`
			);

			// Refresh after configuration change
			await this.refreshUseCase.execute();
		}
	}

	private async handleClearCache(): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			'This will clear the extension cache and rescan all directories. Continue?',
			{ modal: true },
			'Clear Cache'
		);

		if (confirm === 'Clear Cache') {
			await this.refreshUseCase.execute();
			vscode.window.showInformationMessage('Extension cache cleared and directories rescanned.');
		}
	}

	dispose(): void {
		this.logger.debug('CommandHandler disposed');
	}
}
