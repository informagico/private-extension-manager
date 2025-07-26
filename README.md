# Private Extension Manager

A powerful VS Code extension that allows you to manage and install private extensions from local `.vsix` files. Perfect for organizations, teams, or developers who need to distribute custom extensions that aren't available on the official marketplace.

## 🚀 Features

### Core Functionality

- **📁 Directory Scanning**: Automatically scan multiple directories for `.vsix` files
- **🔄 Auto-Discovery**: Real-time file system monitoring for new or updated extensions
- **⚡ One-Click Installation**: Install extensions directly from the sidebar
- **🔄 Update Management**: Detect and install updates for existing extensions
- **🗑️ Easy Uninstallation**: Remove extensions with a single click
- **🔍 Smart Search**: Filter extensions by name, description, author, or keywords

### User Interface

- **📋 Dedicated Sidebar**: Clean, marketplace-style interface in the activity bar
- **📄 Detailed Views**: Rich extension details with README, changelog, and metadata
- **🏷️ Status Indicators**: Visual indicators for installed, available updates, and new extensions
- **🎨 VS Code Integration**: Seamlessly matches your VS Code theme and styling
- **⌨️ Keyboard Navigation**: Full keyboard support with arrow keys and shortcuts

### Extension Management

- **📊 Installation Status**: Track which extensions are installed and which need updates
- **🔄 Automatic Restart**: Configurable extension host restart after installations
- **🏗️ VSIX Parsing**: Complete parsing of extension metadata, including manifests and package.json

## 📸 Screenshots

### Main Sidebar Interface

![Main Sidebar](.\assets\main_sidebar.png)

The extension adds a new "Private Marketplace" section to your VS Code activity bar, showing all available private extensions with their installation status, update availability, and quick action buttons.

### Extension Details View

![Extension Details](.\assets\extension_details.png)

Click on any extension to open a detailed view similar to the VS Code marketplace, complete with:

- Extension description and metadata
- README content (if available)
- Changelog information
- Installation and configuration options
- Categories and keywords

## 🛠️ Installation

1. Download the latest `.vsix` file from your organization or build it from source
2. Open VS Code
3. Go to Extensions view (`Ctrl+Shift+X`)
4. Click the "..." menu and select "Install from VSIX..."
5. Select the downloaded `.vsix` file
6. Reload VS Code when prompted

## ⚙️ Configuration

Configure the extension through VS Code settings (`Ctrl+,`) by searching for "Private Extensions":

### Directory Settings

```json
{
  "privateExtensionsSidebar.vsixDirectories": [
    "~/extensions",
    "/path/to/company/extensions",
    "C:\\Corporate\\Extensions"
  ]
}
```

### Scanning & Performance

- **Auto Scan**: `privateExtensionsSidebar.autoScan` (default: `true`)
  - Automatically monitor directories for changes
- **Load at Startup**: `privateExtensionsSidebar.loadAtStartup` (default: `true`)
  - Scan extensions when VS Code starts
- **Scan Interval**: `privateExtensionsSidebar.scanInterval` (default: `30` seconds)
  - How often to check for changes (0 to disable)

### Display Options

- **Show File Size**: `privateExtensionsSidebar.showFileSize` (default: `false`)
  - Display file sizes in the extension list
- **Show Last Modified**: `privateExtensionsSidebar.showLastModified` (default: `false`)
  - Show when extensions were last modified

### Sorting

- **Sort By**: `privateExtensionsSidebar.sortBy`
  - Options: `name`, `author`, `lastModified`, `fileSize`, `version`
  - Default: `name`
- **Sort Order**: `privateExtensionsSidebar.sortOrder`
  - Options: `ascending`, `descending`
  - Default: `ascending`

### Restart Behavior

- **Auto Restart**: `privateExtensionsSidebar.autoRestartAfterInstall` (default: `false`)
  - Automatically restart extensions without prompting
- **Restart Method**: `privateExtensionsSidebar.restartMethod`
  - Options: `extensionHost`, `reloadWindow`, `prompt`
  - Default: `prompt`

## 🎯 Usage

### First Time Setup

1. **Configure Directories**:
   - Click the gear icon in the Private Marketplace sidebar
   - Add directories containing your `.vsix` files
   - Or use the `+` button to browse and select directories

2. **Scan for Extensions**:
   - The extension will automatically scan configured directories
   - Use the refresh button to manually rescan
   - Extensions appear with status indicators

### Managing Extensions

#### Installing Extensions

- Click the "Install" button next to any uninstalled extension
- Or click on an extension to open details and install from there
- Extensions will be activated after VS Code restarts (configurable)

#### Updating Extensions

- Extensions with available updates show an "Update" badge
- Click "Update" to install the newer version
- The extension automatically detects version differences

#### Uninstalling Extensions

- Right-click installed extensions for context menu options
- Or use the trash icon that appears on hover
- Confirmation dialog prevents accidental removal

### Advanced Features

#### Search and Filter

- Use the search box to filter by name, description, author
- Search also includes keywords and categories
- Supports real-time filtering as you type

#### Keyboard Shortcuts

- `Arrow Keys`: Navigate between extensions
- `Enter`: Open selected extension details
- `Escape`: Clear search (when search box is focused)

#### Extension Details

- Click any extension to open a detailed view
- Tabs for Details, Features, and Changelog
- Links to repository, homepage, and issue tracker
- Technical information including file size and version

## 🔧 Development & Customization

### Supported File Formats

- `.vsix` files (VS Code extension packages)
- Automatic parsing of `package.json` and manifest files
- Support for extension icons, README, and CHANGELOG files

### Directory Monitoring

The extension watches configured directories for:

- New `.vsix` files
- Modified `.vsix` files
- Deleted `.vsix` files
- Changes trigger automatic rescans

### Version Comparison

- Semantic version parsing and comparison
- Handles prerelease versions correctly
- Automatic detection of updates based on version numbers

## 🤝 Use Cases

### Enterprise Environments

- Distribute internal tools and extensions across teams
- Maintain private extension repositories
- Control extension versions and updates

### Development Teams

- Share custom development tools
- Distribute team-specific configurations
- Test extensions before publishing

### Organizations

- Deploy branded extensions
- Maintain compliance with internal tools
- Centralized extension management

## 🛡️ Security & Privacy

- No data is sent to external servers
- All processing happens locally
- File system access limited to configured directories
- Extensions are validated before installation

## 📋 Requirements

- VS Code version 1.74.0 or higher
- Read access to directories containing `.vsix` files
- Appropriate permissions for extension installation

## 🐛 Troubleshooting

### Extensions Not Appearing

1. Check that directories are correctly configured
2. Verify `.vsix` files are valid and not corrupted
3. Ensure VS Code has read permissions for the directories
4. Try manually refreshing with the refresh button

### Installation Issues

1. Check that VS Code has permission to install extensions
2. Verify the `.vsix` file is not corrupted
3. Try restarting VS Code and installing again
4. Check the VS Code output panel for error messages

### Performance Issues

1. Reduce scan interval if monitoring many directories
2. Disable auto-scan for large directories
3. Consider organizing extensions into smaller subdirectories

## 🔄 Updates

The extension automatically checks for updates to private extensions by:

- Comparing version numbers in package.json
- Monitoring file modification dates
- Tracking installation status

## 📝 License

This extension respects the licensing of all managed extensions and only facilitates their installation and management.

---

**Made with ❤️**
