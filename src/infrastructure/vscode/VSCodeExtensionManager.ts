import * as vscode from 'vscode';
import { Injectable } from '../../shared/decorators/Injectable';
import { Extension } from '../../core/domain/entities/Extension';
import { ExtensionId } from '../../core/domain/valueObjects/ExtensionId';
import { Logger } from '../../shared/utils/Logger';
import { InstallationError } from '../../shared/errors/ExtensionError';

@Injectable()
export class VSCodeExtensionManager {
	private logger: Logger;

	constructor() {
		this.logger = new Logger('VSCodeExtensionManager');
	}

	async install(extension: Extension): Promise<boolean> {
		try {
			this.logger.info(`Installing extension: ${extension.id.value}`);

			await vscode.commands.executeCommand(
				'workbench.extensions.installExtension',
				vscode.Uri.file(extension.filePath.value)
			);

			this.logger.info(`Successfully installed: ${extension.metadata.displayName}`);
			return true;
		} catch (error) {
			this.logger.error(`Failed to install extension: ${extension.id.value}`, { error });
			throw new InstallationError(`Failed to install ${extension.metadata.displayName}`, error as Error);
		}
	}

	async uninstall(extensionId: ExtensionId): Promise<boolean> {
		try {
			this.logger.info(`Uninstalling extension: ${extensionId.value}`);

			await vscode.commands.executeCommand(
				'workbench.extensions.uninstallExtension',
				extensionId.value
			);

			this.logger.info(`Successfully uninstalled: ${extensionId.value}`);
			return true;
		} catch (error) {
			this.logger.error(`Failed to uninstall extension: ${extensionId.value}`, { error });
			throw new InstallationError(`Failed to uninstall extension`, error as Error);
		}
	}

	isInstalled(extensionId: ExtensionId): boolean {
		const extension = vscode.extensions.getExtension(extensionId.value);
		return !!extension;
	}

	getInstalledVersion(extensionId: ExtensionId): string | null {
		const extension = vscode.extensions.getExtension(extensionId.value);
		return extension?.packageJSON?.version || null;
	}

	async restartExtensionHost(): Promise<void> {
		try {
			await vscode.commands.executeCommand('workbench.action.restartExtensionHost');
			this.logger.info('Extension host restarted successfully');
		} catch (error) {
			this.logger.warn('Failed to restart extension host, falling back to window reload', { error });
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	}

	async reloadWindow(): Promise<void> {
		await vscode.commands.executeCommand('workbench.action.reloadWindow');
	}

	getAllInstalledExtensionIds(): ExtensionId[] {
		return vscode.extensions.all
			.filter(ext => !ext.packageJSON.isBuiltin)
			.map(ext => new ExtensionId(ext.id));
	}
}
