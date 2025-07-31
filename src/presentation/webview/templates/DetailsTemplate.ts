import * as vscode from 'vscode';
import { Extension } from '../../../core/domain/entities/Extension';
import { marked } from 'marked';

export class DetailsTemplate {
	constructor(private readonly extensionUri: vscode.Uri) { }

	render(extension: Extension): string {
		const nonce = this.getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.getWebviewUri('media')} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${this.getWebviewUri('media')} data: https:; font-src ${this.getWebviewUri('media')};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${this.getWebviewUri('media/reset.css')}" rel="stylesheet">
    <link href="${this.getWebviewUri('media/vscode.css')}" rel="stylesheet">
    <link href="${this.getWebviewUri('node_modules/@vscode/codicons/dist/codicon.css')}" rel="stylesheet">
    <link href="${this.getWebviewUri('media/extension-details.css')}" rel="stylesheet">
    <title>Extension Details</title>
</head>
<body class="extension-details-container">
    ${this.renderHeader(extension)}
    ${this.renderContent(extension)}
    ${this.renderScript(nonce, extension)}
</body>
</html>`;
	}

	private renderHeader(extension: Extension): string {
		const statusDisplay = this.getStatusDisplay(extension);

		return `
            <div class="extension-header">
                <div class="extension-header-content">
                    <div class="extension-icon-container">
                        ${extension.metadata.icon ? `
                            <img src="${extension.metadata.icon}" class="extension-icon-large" alt="${extension.metadata.displayName} icon" />
                        ` : `
                            <div class="icon-placeholder-large">
                                <span class="codicon codicon-extensions"></span>
                            </div>
                        `}
                    </div>
                    <div class="extension-main-info">
                        <h1 class="extension-title">${extension.metadata.displayName}</h1>
                        <div class="extension-publisher">
                            <span class="publisher-name">${extension.metadata.publisher}</span>
                        </div>
                        <div class="extension-description">${extension.metadata.description}</div>
                        <div class="extension-actions">
                            ${statusDisplay.buttons}
                        </div>
                    </div>
                </div>
            </div>
        `;
	}

	private renderContent(extension: Extension): string {
		const readmeHtml = extension.metadata.readme ?
			marked.parse(extension.metadata.readme) :
			'<p>No README.md found in this extension.</p>';

		const changelogHtml = extension.metadata.changelog ?
			marked.parse(extension.metadata.changelog) :
			'<p>No CHANGELOG.md found in this extension.</p>';

		return `
            <div class="content-area">
                <div class="main-content">
                    <div class="tabs-container">
                        <div class="tabs-header">
                            <button class="tab-button active" data-tab="details">Details</button>
                            <button class="tab-button" data-tab="features">Features</button>
                            <button class="tab-button" data-tab="changelog">Changelog</button>
                        </div>
                        
                        <div class="tab-content active" id="details-tab">
                            <div class="markdown-content">
                                ${readmeHtml}
                            </div>
                        </div>
                        
                        <div class="tab-content" id="features-tab">
                            <div class="markdown-content">
                                ${this.generateFeaturesContent(extension)}
                            </div>
                        </div>
                        
                        <div class="tab-content" id="changelog-tab">
                            <div class="markdown-content">
                                ${changelogHtml}
                            </div>
                        </div>
                    </div>
                </div>

                ${this.renderSidebar(extension)}
            </div>
        `;
	}

	private renderSidebar(extension: Extension): string {
		const statusDisplay = this.getStatusDisplay(extension);

		return `
            <div class="extension-sidebar">
                <div class="sidebar-section">
                    <div class="sidebar-content">
                        <div class="metadata-item">
                            <span class="metadata-label">Identifier</span><br>
                            ${extension.id.value}
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Version</span><br>
                            ${extension.version.value}
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Published</span><br>
                            ${extension.filePath.getLastModified().toLocaleDateString()}
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">Status</span><br>
                            ${statusDisplay.badge}
                        </div>
                    </div>
                </div>

                ${extension.metadata.categories && extension.metadata.categories.length > 0 ? `
                <div class="sidebar-section">
                    <div class="sidebar-title">Categories</div>
                    <div class="sidebar-content">
                        <div class="categories-list">
                            ${extension.metadata.categories.map(cat => `<div class="category-tag">${cat}</div>`).join('')}
                        </div>
                    </div>
                </div>
                ` : ''}

                <div class="sidebar-section">
                    <div class="sidebar-title">Resources</div>
                    <div class="sidebar-content">
                        <div class="resources-list">
                            ${extension.metadata.homepage ? `<a href="${extension.metadata.homepage}" class="resource-link">Homepage</a>` : ''}
                            ${extension.metadata.repository ? `<a href="${extension.metadata.repository}" class="resource-link">Repository</a>` : ''}
                            ${extension.metadata.license ? `<div class="resource-item">License: ${extension.metadata.license}</div>` : ''}
                        </div>
                    </div>
                </div>

                <div class="sidebar-section">
                    <div class="sidebar-title">File Information</div>
                    <div class="sidebar-content">
                        <div class="metadata-item">
                            <span class="metadata-label">File Size</span><br>
                            ${this.formatFileSize(extension.filePath.getSize())}
                        </div>
                        <div class="metadata-item">
                            <span class="metadata-label">File Path</span><br>
                            <span class="file-path" title="${extension.filePath.value}">${this.shortenPath(extension.filePath.value)}</span>
                        </div>
                        ${extension.metadata.engines?.vscode ? `
                        <div class="metadata-item">
                            <span class="metadata-label">VS Code Engine</span><br>
                            ${extension.metadata.engines.vscode}
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
	}

	private renderScript(nonce: string, extension: Extension): string {
		return `
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                
                // Tab switching functionality
                document.querySelectorAll('.tab-button').forEach(button => {
                    button.addEventListener('click', () => {
                        const tabName = button.dataset.tab;
                        
                        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                        button.classList.add('active');
                        
                        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                        document.getElementById(tabName + '-tab').classList.add('active');
                    });
                });
                
                // Action button handlers
                function installExtension() {
                    const button = document.getElementById('install-btn') || document.getElementById('update-btn');
                    if (button) {
                        button.innerHTML = '<span class="codicon codicon-sync spin"></span> Installing...';
                        button.disabled = true;
                    }
                    
                    vscode.postMessage({
                        command: 'installExtension'
                    });
                }
                
                function uninstallExtension() {
                    const button = document.getElementById('uninstall-btn');
                    if (button) {
                        button.innerHTML = '<span class="codicon codicon-sync spin"></span> Uninstalling...';
                        button.disabled = true;
                    }
                    
                    vscode.postMessage({
                        command: 'uninstallExtension'
                    });
                }

                function openExtensionSettings() {
                    vscode.postMessage({
                        command: 'openExtensionSettings'
                    });
                }
                
                // Event listeners
                document.addEventListener('DOMContentLoaded', () => {
                    const installBtn = document.getElementById('install-btn');
                    if (installBtn) {
                        installBtn.addEventListener('click', installExtension);
                    }
                    
                    const updateBtn = document.getElementById('update-btn');
                    if (updateBtn) {
                        updateBtn.addEventListener('click', installExtension);
                    }
                    
                    const uninstallBtn = document.getElementById('uninstall-btn');
                    if (uninstallBtn) {
                        uninstallBtn.addEventListener('click', uninstallExtension);
                    }
                    
                    const settingsGear = document.getElementById('settings-gear');
                    if (settingsGear) {
                        settingsGear.addEventListener('click', openExtensionSettings);
                    }
                });
                
                // Handle external links
                document.addEventListener('click', function(e) {
                    const link = e.target.closest('a');
                    if (link && link.classList.contains('resource-link')) {
                        e.preventDefault();
                        vscode.postMessage({
                            command: 'openUrl',
                            url: link.href
                        });
                    }
                });
            </script>
        `;
	}

	private getStatusDisplay(extension: Extension): { badge: string; buttons: string } {
		if (!extension.isInstalled) {
			return {
				badge: '<span class="status-badge not-installed">Not Installed</span>',
				buttons: `
                    <button class="install-button" id="install-btn">
                        <span class="codicon codicon-cloud-download"></span>
                        Install
                    </button>
                `
			};
		} else if (extension.hasUpdate) {
			return {
				badge: '<span class="status-badge installed">Installed</span> <span class="status-badge" style="background-color: var(--vscode-badge-background); color: var(--vscode-badge-foreground); margin-left: 8px;">Update Available</span>',
				buttons: `
                    <button class="install-button update-button" id="update-btn">
                        <span class="codicon codicon-arrow-up"></span>
                        Update
                    </button>
                    <button class="uninstall-button" id="uninstall-btn">
                        <span class="codicon codicon-trash"></span>
                        Uninstall
                    </button>
                    <button class="settings-gear" id="settings-gear" title="Open Extension Settings">
                        <span class="codicon codicon-gear"></span>
                    </button>
                `
			};
		} else {
			return {
				badge: '<span class="status-badge installed">Installed</span>',
				buttons: `
                    <button class="uninstall-button" id="uninstall-btn">
                        <span class="codicon codicon-trash"></span>
                        Uninstall
                    </button>
                    <button class="settings-gear" id="settings-gear" title="Open Extension Settings">
                        <span class="codicon codicon-gear"></span>
                    </button>
                `
			};
		}
	}

	private generateFeaturesContent(extension: Extension): string {
		const sections: string[] = [];

		if (extension.metadata.keywords && extension.metadata.keywords.length > 0) {
			sections.push(`
                <div class="features-section">
                    <h2>Keywords</h2>
                    <div class="features-list">
                        ${extension.metadata.keywords.map(keyword => `<div class="feature-item">• ${keyword}</div>`).join('')}
                    </div>
                </div>
            `);
		}

		if (extension.metadata.categories && extension.metadata.categories.length > 0) {
			sections.push(`
                <div class="features-section">
                    <h2>Categories</h2>
                    <div class="features-list">
                        ${extension.metadata.categories.map(category => `<div class="feature-item">• ${category}</div>`).join('')}
                    </div>
                </div>
            `);
		}

		sections.push(`
            <div class="troubleshooting-section">
                <h2>Technical Information</h2>
                
                ${extension.metadata.engines && Object.keys(extension.metadata.engines).length > 0 ? `
                <div class="troubleshooting-item">
                    <div class="troubleshooting-title">Engine Requirements:</div>
                    <div class="troubleshooting-content">
                        ${Object.entries(extension.metadata.engines).map(([engine, version]) =>
			`<code>${engine}: ${version}</code>`
		).join('<br>')}
                    </div>
                </div>
                ` : ''}
                
                <div class="troubleshooting-item">
                    <div class="troubleshooting-title">Installation:</div>
                    <div class="troubleshooting-content">
                        This extension is installed from a local VSIX file. Updates must be done manually by replacing the VSIX file and reinstalling.
                    </div>
                </div>

                <div class="troubleshooting-item">
                    <div class="troubleshooting-title">File Information:</div>
                    <div class="troubleshooting-content">
                        <strong>Size:</strong> ${this.formatFileSize(extension.filePath.getSize())}<br>
                        <strong>Last Modified:</strong> ${extension.filePath.getLastModified().toLocaleDateString()}<br>
                        <strong>Version:</strong> ${extension.version.value}
                    </div>
                </div>
            </div>
        `);

		if (sections.length === 1) {
			sections.unshift(`
                <div class="features-section">
                    <h2>Extension Features</h2>
                    <p>No specific features or keywords are defined for this extension. Check the Details tab for more information about what this extension provides.</p>
                </div>
            `);
		}

		return sections.join('');
	}

	private formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		const size = bytes / Math.pow(1024, i);
		return `${size.toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
	}

	private shortenPath(filePath: string): string {
		const maxLength = 50;
		if (filePath.length <= maxLength) {
			return filePath;
		}

		const fileName = filePath.split(/[/\\]/).pop() || '';
		const directory = filePath.substring(0, filePath.length - fileName.length);

		if (directory.length + fileName.length <= maxLength) {
			return filePath;
		}

		const availableLength = maxLength - fileName.length - 3;
		const shortenedDir = directory.substring(0, availableLength);

		return `${shortenedDir}...${fileName}`;
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
