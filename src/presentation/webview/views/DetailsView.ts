import * as vscode from 'vscode';
import { Injectable } from '../../../shared/decorators/Injectable';
import { Extension } from '../../../core/domain/entities/Extension';
import { DetailsTemplate } from '../templates/DetailsTemplate';
import { Logger } from '../../../shared/utils/Logger';

@Injectable()
export class DetailsView {
	private panels = new Map<string, vscode.WebviewPanel>();

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger
	) { }

	async showExtensionDetails(extension: Extension): Promise<void> {
		const existingPanel = this.panels.get(extension.id.value);

		if (existingPanel) {
			existingPanel.reveal(vscode.ViewColumn.One);
			this.updatePanelContent(existingPanel, extension);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'extensionDetails',
			extension.metadata.displayName,
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [this.extensionUri],
				retainContextWhenHidden: true
			}
		);

		this.panels.set(extension.id.value, panel);

		panel.onDidDispose(() => {
			this.panels.delete(extension.id.value);
		});

		this.updatePanelContent(panel, extension);
	}

	updateOpenPanels(extensions: Extension[]): void {
		const extensionMap = new Map(extensions.map(ext => [ext.id.value, ext]));

		for (const [extensionId, panel] of this.panels) {
			const extension = extensionMap.get(extensionId);
			if (extension) {
				this.updatePanelContent(panel, extension);
			}
		}
	}

	closePanelForExtension(extensionId: string): void {
		const panel = this.panels.get(extensionId);
		if (panel) {
			panel.dispose();
		}
	}

	getOpenExtensions(): string[] {
		return Array.from(this.panels.keys());
	}

	private updatePanelContent(panel: vscode.WebviewPanel, extension: Extension): void {
		const template = new DetailsTemplate(this.extensionUri);
		panel.webview.html = template.render(extension);
	}

	dispose(): void {
		for (const panel of this.panels.values()) {
			panel.dispose();
		}
		this.panels.clear();
	}
}
