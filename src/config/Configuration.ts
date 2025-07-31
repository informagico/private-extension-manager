import * as vscode from 'vscode';
import { Injectable } from '../shared/decorators/Injectable';
import { ConfigurationTypes } from '../shared/types/ConfigurationTypes';

@Injectable()
export class Configuration {
	private readonly configSection = 'privateExtensionsSidebar';

	constructor(private readonly context: vscode.ExtensionContext) { }

	get vsixDirectories(): string[] {
		return this.getConfig<string[]>('vsixDirectories', []);
	}

	get autoScan(): boolean {
		return this.getConfig<boolean>('autoScan', true);
	}

	get loadAtStartup(): boolean {
		return this.getConfig<boolean>('loadAtStartup', true);
	}

	get scanInterval(): number {
		return this.getConfig<number>('scanInterval', 30);
	}

	get showFileSize(): boolean {
		return this.getConfig<boolean>('showFileSize', false);
	}

	get showLastModified(): boolean {
		return this.getConfig<boolean>('showLastModified', false);
	}

	get sortBy(): ConfigurationTypes.SortBy {
		return this.getConfig<ConfigurationTypes.SortBy>('sortBy', 'name');
	}

	get sortOrder(): ConfigurationTypes.SortOrder {
		return this.getConfig<ConfigurationTypes.SortOrder>('sortOrder', 'ascending');
	}

	get autoRestartAfterInstall(): boolean {
		return this.getConfig<boolean>('autoRestartAfterInstall', false);
	}

	get restartMethod(): ConfigurationTypes.RestartMethod {
		return this.getConfig<ConfigurationTypes.RestartMethod>('restartMethod', 'prompt');
	}

	async updateVsixDirectories(directories: string[]): Promise<void> {
		await this.updateConfig('vsixDirectories', directories, vscode.ConfigurationTarget.Global);
	}

	async updateAutoScan(enabled: boolean): Promise<void> {
		await this.updateConfig('autoScan', enabled, vscode.ConfigurationTarget.Global);
	}

	async updateSortBy(sortBy: ConfigurationTypes.SortBy): Promise<void> {
		await this.updateConfig('sortBy', sortBy, vscode.ConfigurationTarget.Global);
	}

	async updateSortOrder(sortOrder: ConfigurationTypes.SortOrder): Promise<void> {
		await this.updateConfig('sortOrder', sortOrder, vscode.ConfigurationTarget.Global);
	}

	onDidChange(callback: () => void): vscode.Disposable {
		return vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(this.configSection)) {
				callback();
			}
		});
	}

	private getConfig<T>(key: string, defaultValue: T): T {
		const config = vscode.workspace.getConfiguration(this.configSection);
		return config.get<T>(key, defaultValue);
	}

	private async updateConfig<T>(
		key: string,
		value: T,
		target: vscode.ConfigurationTarget
	): Promise<void> {
		const config = vscode.workspace.getConfiguration(this.configSection);
		await config.update(key, value, target);
	}

	getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] | undefined {
		return vscode.workspace.workspaceFolders;
	}

	getExtensionPath(): string {
		return this.context.extensionPath;
	}

	getGlobalStoragePath(): string {
		return this.context.globalStorageUri.fsPath;
	}

	getWorkspaceStoragePath(): string | undefined {
		return this.context.storageUri?.fsPath;
	}
}
