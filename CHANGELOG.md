# Changelog

All notable changes to the Private Extension Manager will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-XX-YY

### 🎉 Major Release - Complete Rewrite

This version represents a complete rewrite of the extension with significant improvements in performance, usability, and functionality.

### ✨ Added

- **New Sidebar Interface**: Dedicated "Private Marketplace" in the activity bar with modern, marketplace-style UI
- **Extension Details View**: Rich detail pages with tabs for README, Features, and Changelog
- **Real-time File Monitoring**: Automatic detection of new/updated/removed `.vsix` files
- **Advanced Search**: Filter extensions by name, description, author, keywords, and categories
- **Update Detection**: Automatic detection of available updates based on version comparison
- **Keyboard Navigation**: Full keyboard support with arrow keys, Enter, and Escape shortcuts
- **Status Indicators**: Visual badges for installed, update available, and installation status
- **Icon Support**: Display extension icons with automatic placeholder generation
- **Context Menus**: Right-click context menus for additional actions
- **Toast Notifications**: User-friendly feedback for actions and errors
- **Selection State**: Remember selected extension across refreshes
- **Loading States**: Visual feedback during scanning and installation operations
- **VSIX Validation**: Comprehensive validation of extension files before installation
- **Complete VSIX Parsing**: Extract and display all metadata including manifest data
- **Markdown Rendering**: Proper rendering of README and CHANGELOG content

### 🔧 Enhanced Settings

- **Multiple Directory Support**: Configure multiple directories to scan for extensions
- **Auto-scan Options**: Control automatic directory monitoring
- **Startup Loading**: Configure whether to load extensions at VS Code startup
- **Scan Interval**: Customizable refresh intervals (5+ seconds or disabled)
- **Display Options**: Toggle file size and last modified date visibility
- **Sorting Options**: Sort by name, author, date, size, or version with ascending/descending order
- **Restart Behavior**: Configure automatic restart after install/update/uninstall
- **Restart Methods**: Choose between extension host restart, window reload, or user prompt

### 🚀 Performance Improvements

- **Lazy Loading**: Extensions load only when needed, improving startup time
- **Efficient Caching**: Smart caching system reduces redundant file parsing
- **Background Scanning**: Non-blocking directory scans prevent UI freezing
- **Debounced File Watching**: Intelligent file system monitoring reduces unnecessary scans
- **Memory Optimization**: Better memory management for large extension collections
- **Concurrent Processing**: Parallel processing of multiple `.vsix` files

### 🎨 UI/UX Improvements

- **Modern Design**: Clean, professional interface matching VS Code's design language
- **Responsive Layout**: Adaptive design for different sidebar widths
- **Accessibility**: Improved screen reader support and keyboard navigation
- **Visual Hierarchy**: Clear information hierarchy with proper typography
- **State Management**: Persistent search and selection state across sessions
- **Error Handling**: User-friendly error messages and recovery options
- **Progress Feedback**: Clear progress indication for long-running operations

### 🔒 Security & Reliability

- **Input Validation**: Comprehensive validation of all user inputs and file paths
- **Error Recovery**: Graceful handling of corrupted files and network issues
- **Permission Checks**: Proper validation of file system permissions
- **Safe Installation**: Protected installation process with rollback capabilities
- **Resource Management**: Proper cleanup of file watchers and resources

### 🛠️ Developer Experience

- **TypeScript Rewrite**: Complete rewrite in TypeScript for better maintainability
- **Modular Architecture**: Clean separation of concerns with dedicated modules
- **Comprehensive Logging**: Detailed logging for debugging and troubleshooting
- **Event-Driven Design**: Reactive architecture using VS Code's event system

### 📊 Technical Improvements

- **ZIP Archive Parsing**: Custom ZIP parser for efficient `.vsix` file handling
- **Semantic Versioning**: Proper semantic version parsing and comparison
- **Manifest Processing**: Complete extraction and processing of extension manifests
- **Icon Extraction**: Direct extraction of extension icons from `.vsix` files
- **Content Extraction**: Extract README, CHANGELOG, and other documentation
- **Metadata Caching**: Intelligent caching of parsed extension metadata

### 🔄 Migration & Compatibility

- **VS Code Compatibility**: Full compatibility with VS Code 1.74.0 and newer
- **Cross-Platform**: Consistent behavior across Windows, macOS, and Linux

### 🗑️ Removed

- **Legacy Tree View**: Replaced with modern sidebar interface
- **Synchronous Operations**: All operations are now asynchronous
- **Manual Refresh Only**: Replaced with automatic monitoring
- **Basic File Listing**: Replaced with rich metadata display

### ⚠️ Breaking Changes

- Command names have been updated for consistency
- Some API endpoints have been removed in favor of the new architecture
- Minimum VS Code version is now 1.74.0

### 📋 Dependencies

- Added `@vscode/codicons` for consistent iconography
- Added `marked` for Markdown rendering
- Updated TypeScript to 4.9.4 for better type safety
- Updated Node.js types to 16.x for compatibility

---

## Planned Features

### [2.1.0] - Future Release

- **Extension Packs**: Support for installing multiple related extensions
- **Category Filtering**: Filter extensions by category in the UI
- **Export/Import**: Export extension lists and import them on other machines
- **Advanced Search**: Regex support and saved search queries

### [2.2.0] - Future Release

- **Rollback Support**: Roll back to previous extension versions
