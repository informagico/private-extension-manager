import { Injectable } from '../../../shared/decorators/Injectable';
import { VSCodeExtensionManager } from '../../../infrastructure/vscode/VSCodeExtensionManager';
import { Extension } from '../../domain/entities/Extension';
import { ExtensionId } from '../../domain/valueObjects/ExtensionId';
import { EventBus } from '../events/EventBus';
import { ExtensionEvent } from '../events/ExtensionEvent';
import { Logger } from '../../../shared/utils/Logger';
import { Configuration } from '../../../config/Configuration';
import * as vscode from 'vscode';

@Injectable()
export class InstallationService {
	constructor(
		private readonly vsCodeManager: VSCodeExtensionManager,
		private readonly eventBus: EventBus,
		private readonly logger: Logger,
		private readonly configuration: Configuration
	) { }

	async install(extension: Extension): Promise<boolean> {
		const success = await this.vsCodeManager.install(extension);

		if (success) {
			await this.handlePostInstallation(extension);
		}

		return success;
	}

	async uninstall(extension: Extension): Promise<boolean> {
		const success = await this.vsCodeManager.uninstall(extension.id);

		if (success) {
			await this.handlePostUninstallation(extension);
		}

		return success;
	}

	isInstalled(extensionId: ExtensionId): boolean {
		return this.vsCodeManager.isInstalled(extensionId);
	}

	getInstalledVersion(extensionId: ExtensionId): string | null {
		return this.vsCodeManager.getInstalledVersion(extensionId);
	}

	private async handlePostInstallation(extension: Extension): Promise<void> {
		this.logger.info(`Post-installation handling for: ${extension.metadata.displayName}`);

		const restartMethod = this.configuration.restartMethod;
		const autoRestart = this.configuration.autoRestartAfterInstall;

		if (autoRestart && restartMethod !== 'prompt') {
			await this.performRestart(restartMethod, extension.metadata.displayName, 'installed');
		} else {
			await this.promptForRestart(extension.metadata.displayName, 'installed');
		}
	}

	private async handlePostUninstallation(extension: Extension): Promise<void> {
		this.logger.info(`Post-uninstallation handling for: ${extension.metadata.displayName}`);

		const restartMethod = this.configuration.restartMethod;
		const autoRestart = this.configuration.autoRestartAfterInstall;

		if (autoRestart && restartMethod !== 'prompt') {
			await this.performRestart(restartMethod, extension.metadata.displayName, 'uninstalled');
		} else {
			await this.promptForRestart(extension.metadata.displayName, 'uninstalled');
		}
	}

	private async performRestart(method: string, extensionName: string, action: string): Promise<void> {
		vscode.window.showInformationMessage(
			`${extensionName} ${action} successfully. Restarting extensions...`
		);

		setTimeout(async () => {
			try {
				if (method === 'extensionHost') {
					await this.vsCodeManager.restartExtensionHost();
				} else {
					await this.vsCodeManager.reloadWindow();
				}
			} catch (error) {
				this.logger.error('Failed to restart automatically', { error });
				vscode.window.showWarningMessage(
					'Failed to restart automatically. Please reload the window manually.'
				);
			}
		}, 1000);
	}

	private async promptForRestart(extensionName: string, action: string): Promise<void> {
		const choice = await vscode.window.showInformationMessage(
			`${extensionName} ${action} successfully. Choose how to apply changes:`,
			'Restart Extensions',
			'Reload Window',
			'Later'
		);

		switch (choice) {
			case 'Restart Extensions':
				try {
					await this.vsCodeManager.restartExtensionHost();
				} catch (error) {
					const fallbackChoice = await vscode.window.showWarningMessage(
						'Extension host restart failed. Reload the window instead?',
						'Reload Window',
						'Cancel'
					);
					if (fallbackChoice === 'Reload Window') {
						await this.vsCodeManager.reloadWindow();
					}
				}
				break;
			case 'Reload Window':
				await this.vsCodeManager.reloadWindow();
				break;
			case 'Later':
				vscode.window.showInformationMessage(
					'Extension changes will take effect after the next window reload.',
					'Reload Now'
				).then(choice => {
					if (choice === 'Reload Now') {
						vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				});
				break;
		}
	}
}
