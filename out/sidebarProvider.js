"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivateExtensionsSidebarProvider = void 0;
// src/sidebarProvider.ts
const vscode = require("vscode");
class PrivateExtensionsSidebarProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
        this._items = [
            {
                id: '1',
                title: '.NET Install Tool',
                description: 'This extension installs and manages different versions of the .NET SDK and runtime.',
                icon: 'https://fastly.picsum.photos/id/634/128/128.jpg?hmac=_0_bD8fHB5Rfnx1q1rk6wVpggrnLnT1GCfjCcHoUUf8',
                author: 'Microsoft',
                isInstalled: true,
                hasUpdate: true
            },
            {
                id: '2',
                title: 'Auto Comment Blocks',
                description: 'Provides block comment completion for Javadoc-style multi-line comments.',
                icon: null,
                author: 'kky',
                isInstalled: false
            },
            {
                id: '3',
                title: 'Better C++ Syntax',
                description: 'The bleeding edge of the C++ syntax',
                icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
                author: 'Jeff Hykin',
                isInstalled: true,
                hasUpdate: false
            },
            {
                id: '4',
                title: 'C/C++',
                description: 'C/C++ IntelliSense, debugging, and code browsing.',
                icon: null,
                author: 'Microsoft',
                isInstalled: false
            },
            {
                id: '5',
                title: 'C# Extensions',
                description: 'C# IDE Extensions for VSCode',
                icon: 'data:image/jpeg;base64,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',
                author: 'JosKreativ',
                isInstalled: true,
                hasUpdate: true
            }
        ];
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'itemClicked':
                    this._handleItemClick(message.itemId);
                    break;
                case 'deleteItem':
                    this._deleteItem(message.itemId);
                    break;
                case 'toggleStatus':
                    this._toggleItemStatus(message.itemId);
                    break;
                case 'openInEditor':
                    this._openInEditor(message.itemId);
                    break;
                case 'installItem':
                    this._installItem(message.itemId);
                    break;
                case 'updateItem':
                    this._updateItem(message.itemId);
                    break;
            }
        }, undefined, []);
    }
    refresh() {
        if (this._view) {
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
        }
    }
    addItem() {
        const newItem = {
            id: Date.now().toString(),
            title: `New Extension ${this._items.length + 1}`,
            description: 'This is a new extension added to the marketplace',
            icon: null,
            author: 'Developer',
            isInstalled: false
        };
        this._items.unshift(newItem);
        this.refresh();
    }
    _handleItemClick(itemId) {
        const item = this._items.find(i => i.id === itemId);
        if (item) {
            vscode.window.showInformationMessage(`Clicked on: ${item.title}`);
        }
    }
    _deleteItem(itemId) {
        this._items = this._items.filter(item => item.id !== itemId);
        this.refresh();
    }
    _toggleItemStatus(itemId) {
        vscode.window.showInformationMessage('Toggle action triggered');
        this.refresh();
    }
    _installItem(itemId) {
        const item = this._items.find(i => i.id === itemId);
        if (item && !item.isInstalled) {
            item.isInstalled = true;
            this.refresh();
            vscode.window.showInformationMessage(`${item.title} has been installed!`);
        }
    }
    _updateItem(itemId) {
        const item = this._items.find(i => i.id === itemId);
        if (item && item.isInstalled && item.hasUpdate) {
            item.hasUpdate = false;
            this.refresh();
            vscode.window.showInformationMessage(`${item.title} has been updated!`);
        }
    }
    _openInEditor(itemId) {
        const item = this._items.find(i => i.id === itemId);
        if (item) {
            vscode.workspace.openTextDocument({
                content: `# ${item.title}\n\n${item.description}\n\nAuthor: ${item.author}`,
                language: 'markdown'
            }).then(doc => {
                vscode.window.showTextDocument(doc);
            });
        }
    }
    _getSortedItems() {
        return [...this._items].sort((a, b) => {
            // Priority 1: Items with updates available (installed + hasUpdate)
            const aHasUpdate = a.isInstalled && a.hasUpdate;
            const bHasUpdate = b.isInstalled && b.hasUpdate;
            if (aHasUpdate && !bHasUpdate)
                return -1;
            if (!aHasUpdate && bHasUpdate)
                return 1;
            // Priority 2: Installed items (without updates)
            const aInstalledNoUpdate = a.isInstalled && !a.hasUpdate;
            const bInstalledNoUpdate = b.isInstalled && !b.hasUpdate;
            if (aInstalledNoUpdate && !bInstalledNoUpdate && !bHasUpdate)
                return -1;
            if (!aInstalledNoUpdate && bInstalledNoUpdate && !aHasUpdate)
                return 1;
            // Priority 3: Not installed items
            if (!a.isInstalled && b.isInstalled)
                return 1;
            if (a.isInstalled && !b.isInstalled)
                return -1;
            // Within same category, sort alphabetically by title
            return a.title.localeCompare(b.title);
        });
    }
    _getHtmlForWebview(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
        const nonce = getNonce();
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">
                <title>Private Extensions</title>
            </head>
            <body>
                <div class="container">
                    <div class="search-container">
                        <input type="text" id="search-input" placeholder="Search in Private Marketplace" />
                    </div>
                    
                    <div class="items-container">
                        ${this._getSortedItems().map(item => `
                            <div class="item ${item.isInstalled ? 'installed' : 'not-installed'}" data-item-id="${item.id}" tabindex="0">
                                <div class="item-icon-container">
                                    <div class="item-main-icon">
                                        ${item.icon ? `
                                            <img src="${item.icon}" class="extension-icon" />
                                        ` : `
                                            <div class="icon-placeholder">
                                                <span class="codicon codicon-extensions"></span>
                                            </div>
                                        `}
                                    </div>
                                </div>
                                <div class="item-content">
                                    <div class="item-header">
                                        <div class="item-title">${item.title}</div>
                                        ${item.isInstalled ? `
                                            <div class="item-actions">
                                                <button class="action-btn toggle-status-btn" title="Toggle Status">
                                                    <span class="codicon codicon-circle-filled"></span>
                                                </button>
                                                <button class="action-btn open-btn" title="Open in Editor">
                                                    <span class="codicon codicon-go-to-file"></span>
                                                </button>
                                                <button class="action-btn delete-btn" title="Uninstall">
                                                    <span class="codicon codicon-trash"></span>
                                                </button>
                                            </div>
                                        ` : ''}
                                    </div>
                                    <div class="item-description">${item.description}</div>
                                    <div class="item-meta-wrapper">
                                        <div class="item-author">
                                            <span class="author-name">${item.author}</span>
                                        </div>
                                        ${!item.isInstalled ? `
                                            <button class="install-btn" data-item-id="${item.id}">
                                                Install
                                            </button>
                                        ` : item.hasUpdate ? `
                                            <button class="update-btn" data-item-id="${item.id}">
                                                Update
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}
exports.PrivateExtensionsSidebarProvider = PrivateExtensionsSidebarProvider;
PrivateExtensionsSidebarProvider.viewType = 'privateExtensionsSidebar.sidebarView';
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
//# sourceMappingURL=sidebarProvider.js.map
