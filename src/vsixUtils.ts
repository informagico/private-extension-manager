import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface VsixValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
}

export class VsixUtils {
	/**
	 * Validate a VSIX file path
	 */
	static validateFilePath(filePath: string): VsixValidationResult {
		const result: VsixValidationResult = {
			isValid: true,
			errors: [],
			warnings: []
		};

		// Check if file exists
		if (!fs.existsSync(filePath)) {
			result.isValid = false;
			result.errors.push(`File does not exist: ${filePath}`);
			return result;
		}

		// Check file extension
		if (path.extname(filePath).toLowerCase() !== '.vsix') {
			result.isValid = false;
			result.errors.push(`Invalid file extension. Expected .vsix, got: ${path.extname(filePath)}`);
		}

		// Check file size (warn if very large)
		try {
			const stats = fs.statSync(filePath);
			const fileSizeMB = stats.size / (1024 * 1024);

			if (fileSizeMB > 100) {
				result.warnings.push(`Large file size: ${fileSizeMB.toFixed(2)} MB`);
			}

			if (stats.size === 0) {
				result.isValid = false;
				result.errors.push('File is empty');
			}
		} catch (error) {
			result.isValid = false;
			result.errors.push(`Cannot read file stats: ${error}`);
		}

		// Check file permissions
		try {
			fs.accessSync(filePath, fs.constants.R_OK);
		} catch (error) {
			result.isValid = false;
			result.errors.push(`Cannot read file: ${error}`);
		}

		return result;
	}

	/**
	 * Sanitize extension ID
	 */
	static sanitizeExtensionId(publisher: string, name: string): string {
		const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9\-_]/g, '').toLowerCase();
		return `${sanitize(publisher)}.${sanitize(name)}`;
	}

	/**
	 * Format file size for display
	 */
	static formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';

		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		const size = bytes / Math.pow(1024, i);

		return `${size.toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
	}

	/**
	 * Parse semantic version
	 */
	static parseSemanticVersion(version: string): {
		major: number;
		minor: number;
		patch: number;
		prerelease?: string;
		build?: string;
		raw: string;
	} {
		const versionRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+(.+))?$/;
		const match = version.match(versionRegex);

		if (!match) {
			// Fallback for non-semantic versions
			const parts = version.split('.');
			return {
				major: parseInt(parts[0], 10) || 0,
				minor: parseInt(parts[1], 10) || 0,
				patch: parseInt(parts[2], 10) || 0,
				raw: version
			};
		}

		return {
			major: parseInt(match[1], 10),
			minor: parseInt(match[2], 10),
			patch: parseInt(match[3], 10),
			prerelease: match[4],
			build: match[5],
			raw: version
		};
	}

	/**
	 * Compare two semantic versions
	 */
	static compareVersions(version1: string, version2: string): number {
		const v1 = VsixUtils.parseSemanticVersion(version1);
		const v2 = VsixUtils.parseSemanticVersion(version2);

		// Compare major.minor.patch
		if (v1.major !== v2.major) return v1.major - v2.major;
		if (v1.minor !== v2.minor) return v1.minor - v2.minor;
		if (v1.patch !== v2.patch) return v1.patch - v2.patch;

		// Handle prerelease versions
		if (v1.prerelease && !v2.prerelease) return -1;
		if (!v1.prerelease && v2.prerelease) return 1;
		if (v1.prerelease && v2.prerelease) {
			return v1.prerelease.localeCompare(v2.prerelease);
		}

		return 0;
	}

	/**
	 * Check if a version is newer than another
	 */
	static isNewerVersion(newVersion: string, currentVersion: string): boolean {
		return VsixUtils.compareVersions(newVersion, currentVersion) > 0;
	}

	/**
	 * Extract extension categories for display
	 */
	static categorizeExtension(categories?: string[]): {
		primary: string;
		secondary: string[];
		displayColor: string;
	} {
		const categoryMap: { [key: string]: string } = {
			'Programming Languages': '#007ACC',
			'Snippets': '#28A745',
			'Linters': '#DC3545',
			'Themes': '#6F42C1',
			'Debuggers': '#FD7E14',
			'Formatters': '#20C997',
			'Keymaps': '#6C757D',
			'SCM Providers': '#198754',
			'Extension Packs': '#0D6EFD',
			'Education': '#E83E8C',
			'Data Science': '#795548',
			'Machine Learning': '#FF5722',
			'Visualization': '#9C27B0',
			'Testing': '#FF9800',
			'Azure': '#0078D4',
			'Other': '#6C757D'
		};

		if (!categories || categories.length === 0) {
			return {
				primary: 'Other',
				secondary: [],
				displayColor: categoryMap['Other']
			};
		}

		const primary = categories[0];
		const secondary = categories.slice(1);
		const displayColor = categoryMap[primary] || categoryMap['Other'];

		return { primary, secondary, displayColor };
	}

	/**
	 * Generate extension display name
	 */
	static generateDisplayName(packageJson: any): string {
		if (packageJson.displayName) {
			return packageJson.displayName;
		}

		// Convert kebab-case or snake_case to Title Case
		return packageJson.name
			.replace(/[-_]/g, ' ')
			.replace(/\b\w/g, (char: string) => char.toUpperCase());
	}

	/**
	 * Validate extension ID format
	 */
	static validateExtensionId(extensionId: string): VsixValidationResult {
		const result: VsixValidationResult = {
			isValid: true,
			errors: [],
			warnings: []
		};

		const idRegex = /^[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+$/;

		if (!idRegex.test(extensionId)) {
			result.isValid = false;
			result.errors.push(`Invalid extension ID format: ${extensionId}`);
		}

		const parts = extensionId.split('.');
		if (parts.length !== 2) {
			result.isValid = false;
			result.errors.push(`Extension ID must have format "publisher.name"`);
		}

		if (parts[0] && parts[0].length < 2) {
			result.warnings.push('Publisher name is very short');
		}

		if (parts[1] && parts[1].length < 2) {
			result.warnings.push('Extension name is very short');
		}

		return result;
	}

	/**
	 * Get extension icon placeholder
	 */
	static getIconPlaceholder(extensionName: string): string {
		const colors = [
			'#007ACC', '#28A745', '#DC3545', '#6F42C1', '#FD7E14',
			'#20C997', '#6C757D', '#198754', '#0D6EFD', '#E83E8C'
		];

		const hash = extensionName.split('').reduce((acc, char) => {
			return char.charCodeAt(0) + ((acc << 5) - acc);
		}, 0);

		const colorIndex = Math.abs(hash) % colors.length;
		const color = colors[colorIndex];

		const initials = extensionName
			.split(/[-_\s]+/)
			.map(word => word.charAt(0).toUpperCase())
			.slice(0, 2)
			.join('');

		// Generate SVG placeholder
		const svg = `
            <svg width="42" height="42" xmlns="http://www.w3.org/2000/svg">
                <rect width="42" height="42" fill="${color}" rx="4"/>
                <text x="21" y="28" font-family="Arial, sans-serif" font-size="16" 
                      font-weight="bold" fill="white" text-anchor="middle">${initials}</text>
            </svg>
        `;

		return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
	}

	/**
	 * Create error message for user display
	 */
	static createUserFriendlyError(error: any, context: string): string {
		if (typeof error === 'string') {
			return `${context}: ${error}`;
		}

		if (error && error.message) {
			return `${context}: ${error.message}`;
		}

		if (error && error.code) {
			switch (error.code) {
				case 'ENOENT':
					return `${context}: File or directory not found`;
				case 'EACCES':
					return `${context}: Permission denied`;
				case 'ENOTDIR':
					return `${context}: Path is not a directory`;
				case 'EISDIR':
					return `${context}: Path is a directory, expected a file`;
				default:
					return `${context}: ${error.code}`;
			}
		}

		return `${context}: Unknown error occurred`;
	}

	/**
	 * Log with timestamp and context
	 */
	static log(level: 'info' | 'warn' | 'error', message: string, context?: string): void {
		const timestamp = new Date().toISOString();
		const contextStr = context ? ` [${context}]` : '';
		const logMessage = `${timestamp}${contextStr}: ${message}`;

		switch (level) {
			case 'info':
				console.log(logMessage);
				break;
			case 'warn':
				console.warn(logMessage);
				break;
			case 'error':
				console.error(logMessage);
				break;
		}
	}
}
