import * as vscode from 'vscode';
import { Injectable } from '../../../shared/decorators/Injectable';
import { Extension } from '../../../core/domain/entities/Extension';
import { Logger } from '../../../shared/utils/Logger';

@Injectable()
export class SidebarView {
	private webview?: vscode.Webview;
	private extensions: Extension[] = [];
	private selectedExtensionId?: string;
	private isLoading = false;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger
	) { }

	setWebview(webview: vscode.Webview): void {
		this.webview = webview;
	}

	render(): void {
		// The actual rendering is handled by the SidebarProvider
		// This method can be used for any post-render logic
		this.logger.debug('SidebarView render called');
	}

	updateExtensionList(extensions: Extension[]): void {
		this.extensions = extensions;

		if (this.webview) {
			this.webview.postMessage({
				command: 'extensionsUpdated',
				extensions: extensions.map(ext => this.extensionToViewModel(ext))
			});
		}
	}

	setSelectedExtension(extensionId: string): void {
		this.selectedExtensionId = extensionId;

		if (this.webview) {
			this.webview.postMessage({
				command: 'setSelection',
				selectedExtensionId: extensionId
			});
		}
	}

	showLoading(): void {
		this.isLoading = true;

		if (this.webview) {
			this.webview.postMessage({
				command: 'showLoading'
			});
		}
	}

	hideLoading(): void {
		this.isLoading = false;

		if (this.webview) {
			this.webview.postMessage({
				command: 'hideLoading'
			});
		}
	}

	showInstallProgress(extensionId: string): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showInstallProgress',
				extensionId
			});
		}
	}

	showInstallSuccess(extensionId: string): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showInstallSuccess',
				extensionId
			});
		}
	}

	showInstallError(extensionId: string, message: string): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showInstallError',
				extensionId,
				message
			});
		}
	}

	showUninstallProgress(extensionId: string): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showUninstallProgress',
				extensionId
			});
		}
	}

	showUninstallSuccess(extensionId: string): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showUninstallSuccess',
				extensionId
			});
		}
	}

	showUninstallError(extensionId: string, message: string): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showUninstallError',
				extensionId,
				message
			});
		}
	}

	showError(message: string): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showError',
				message
			});
		}
	}

	showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
		if (this.webview) {
			this.webview.postMessage({
				command: 'showToast',
				message,
				type
			});
		}
	}

	private extensionToViewModel(extension: Extension): any {
		return {
			id: extension.id.value,
			title: extension.metadata.displayName,
			description: extension.metadata.description,
			author: extension.metadata.author,
			version: extension.version.value,
			icon: extension.metadata.icon,
			isInstalled: extension.isInstalled,
			hasUpdate: extension.hasUpdate,
			categories: extension.metadata.categories,
			fileSize: extension.filePath.getSize(),
			lastModified: extension.filePath.getLastModified(),
			filePath: extension.filePath.value
		};
	}
}
