import * as vscode from 'vscode';
import { Injectable } from '../../shared/decorators/Injectable';
import { SidebarController } from '../webview/controllers/SidebarController';
import { Extension } from '../../core/domain/entities/Extension';

@Injectable()
export class SidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'privateExtensionsSidebar.sidebarView';
	private view?: vscode.WebviewView;

	constructor(
		private readonly controller: SidebarController,
		private readonly extensionUri: vscode.Uri
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		// Set the webview in the controller
		this.controller.setWebview(webviewView.webview);

		// Set initial HTML content
		webviewView.webview.html = this.getHtmlForWebview(webviewView.webview, []);

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(
			async message => {
				await this.handleWebviewMessage(message);
			},
			undefined,
			[]
		);

		// Initialize the controller
		this.controller.initialize();
	}

	private async handleWebviewMessage(message: any): Promise<void> {
		switch (message.command) {
			case 'itemClicked':
				this.controller.handleExtensionSelect(message.itemId);
				break;
			case 'installItem':
				await this.controller.handleInstall(message.itemId);
				break;
			case 'deleteItem':
			case 'toggleStatus':
				await this.controller.handleUninstall(message.itemId);
				break;
			case 'updateItem':
				await this.controller.handleInstall(message.itemId); // Update is same as install
				break;
			case 'refresh':
				await this.controller.handleRefresh();
				break;
			case 'addItem':
				// This will be handled by command handler
				await vscode.commands.executeCommand('privateExtensionsSidebar.addItem');
				break;
			case 'search':
				await this.controller.handleSearch(message.query || '');
				break;
		}
	}

	// Update the webview content when extensions change
	public updateExtensions(extensions: Extension[]): void {
		if (this.view) {
			this.view.webview.html = this.getHtmlForWebview(this.view.webview, extensions);
		}
	}

	private getHtmlForWebview(webview: vscode.Webview, extensions: Extension[]): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
		const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));

		const nonce = this.getNonce();

		return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">
                <title>Private Extensions</title>
            </head>
            <body>
                <div class="container">
                    <div class="search-container">
                        <input type="text" id="search-input" placeholder="Search Extensions in Private Marketplace" />
                    </div>
                    
                    <div class="items-container">
                        ${this.renderExtensionList(extensions)}
                    </div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
	}

	private renderExtensionList(extensions: Extension[]): string {
		if (extensions.length === 0) {
			return `
                <div class="empty-state">
                    <div class="codicon codicon-folder-opened"></div>
                    <div>No extensions found</div>
                    <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">
                        Configure directories in settings or click the + button to add directories
                    </div>
                </div>
            `;
		}

		return extensions.map(extension => this.renderExtensionItem(extension)).join('');
	}

	private renderExtensionItem(extension: Extension): string {
		const statusClass = extension.isInstalled ? 'installed' : 'not-installed';

		return `
            <div class="item ${statusClass}" data-item-id="${extension.id.value}" tabindex="0">
                <div class="item-icon-container">
                    <div class="item-main-icon">
                        ${extension.metadata.icon ? `
                            <img src="${extension.metadata.icon}" class="extension-icon" />
                        ` : `
                            <div class="icon-placeholder">
                                <span class="codicon codicon-extensions"></span>
                            </div>
                        `}
                    </div>
                    ${extension.hasUpdate ? `
                        <div class="update-badge" title="Update Available">
                            <span class="codicon codicon-arrow-up"></span>
                        </div>
                    ` : ''}
                </div>
                <div class="item-content">
                    <div class="item-header">
                        <div class="item-title">${extension.metadata.displayName}</div>
                        ${extension.isInstalled ? `
                            <div class="item-actions">
                                <button class="action-btn delete-btn" title="Uninstall">
                                    <span class="codicon codicon-trash"></span>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div class="item-description">${extension.metadata.description}</div>
                    
                    <div class="item-meta-wrapper">
                        <div class="item-meta">
                            <div class="item-author">
                                <span class="author-name">${extension.metadata.author}</span>
                                <span class="version">v${extension.version.value}</span>
                            </div>
                        </div>
                        ${!extension.isInstalled ? `
                            <button class="install-btn" data-item-id="${extension.id.value}">
                                <span class="codicon codicon-cloud-download"></span>
                                Install
                            </button>
                        ` : extension.hasUpdate ? `
                            <button class="update-btn" data-item-id="${extension.id.value}">
                                <span class="codicon codicon-arrow-up"></span>
                                Update
                            </button>
                        ` : `
                            <div class="installed-badge">
                                <span class="codicon codicon-check"></span>
                                Installed
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;
	}

	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
