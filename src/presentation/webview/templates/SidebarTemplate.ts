import * as vscode from 'vscode';
import { Extension } from '../../../core/domain/entities/Extension';

export interface SidebarTemplateData {
	extensions: Extension[];
	selectedExtensionId?: string;
	isLoading: boolean;
}

export class SidebarTemplate {
	constructor(private readonly extensionUri: vscode.Uri) { }

	render(data: SidebarTemplateData): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.getWebviewUri('media')} 'unsafe-inline'; script-src 'nonce-${this.getNonce()}'; img-src ${this.getWebviewUri('media')} data: https:; font-src ${this.getWebviewUri('media')};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${this.getWebviewUri('media/reset.css')}" rel="stylesheet">
    <link href="${this.getWebviewUri('media/vscode.css')}" rel="stylesheet">
    <link href="${this.getWebviewUri('node_modules/@vscode/codicons/dist/codicon.css')}" rel="stylesheet">
    <link href="${this.getWebviewUri('media/main.css')}" rel="stylesheet">
    <title>Private Extensions</title>
</head>
<body>
    <div class="container">
        <div class="search-container">
            <input type="text" id="search-input" placeholder="Search Extensions in Private Marketplace" />
        </div>
        
        <div class="items-container">
            ${this.renderExtensionList(data)}
        </div>
    </div>

    <script nonce="${this.getNonce()}" src="${this.getWebviewUri('media/main.js')}"></script>
</body>
</html>`;
	}

	private renderExtensionList(data: SidebarTemplateData): string {
		if (data.isLoading) {
			return `
                <div class="loading">
                    <div class="codicon codicon-sync spin"></div>
                    <div>Loading extensions...</div>
                </div>
            `;
		}

		if (data.extensions.length === 0) {
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

		return data.extensions.map(extension => this.renderExtensionItem(extension, data.selectedExtensionId)).join('');
	}

	private renderExtensionItem(extension: Extension, selectedId?: string): string {
		const isSelected = selectedId === extension.id.value;
		const statusClass = extension.isInstalled ? 'installed' : 'not-installed';
		const selectedClass = isSelected ? 'selected' : '';

		return `
            <div class="item ${statusClass} ${selectedClass}" data-item-id="${extension.id.value}" tabindex="0">
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

	private getWebviewUri(relativePath: string): vscode.Uri {
		return vscode.Uri.joinPath(this.extensionUri, relativePath);
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
