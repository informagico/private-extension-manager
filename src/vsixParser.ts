import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);

export interface VsixPackageJson {
	name: string;
	displayName?: string;
	description?: string;
	version: string;
	publisher: string;
	author?: string | { name: string; email?: string; url?: string };
	icon?: string;
	categories?: string[];
	keywords?: string[];
	engines?: { [key: string]: string };
	activationEvents?: string[];
	contributes?: any;
	scripts?: { [key: string]: string };
	dependencies?: { [key: string]: string };
	devDependencies?: { [key: string]: string };
	repository?: string | { type: string; url: string };
	bugs?: string | { url: string; email?: string };
	homepage?: string;
	license?: string;
	main?: string;
	galleryBanner?: {
		color?: string;
		theme?: string;
	};
	preview?: boolean;
	qna?: string | boolean;
	badges?: Array<{
		url: string;
		href: string;
		description: string;
	}>;
}

export interface VsixManifest {
	PackageManifest: {
		Metadata: Array<{
			Identity: Array<{
				$: {
					Id: string;
					Version: string;
					Language: string;
					Publisher: string;
				};
			}>;
			DisplayName: Array<string>;
			Description: Array<{
				_?: string;
				$?: { 'xml:space': string };
			}>;
			Tags?: Array<string>;
			Categories?: Array<string>;
			GalleryFlags?: Array<string>;
			Properties?: Array<{
				Property: Array<{
					$: {
						Id: string;
						Value: string;
					};
				}>;
			}>;
		}>;
		Installation: Array<{
			InstallationTarget: Array<{
				$: {
					Id: string;
					Version: string;
				};
			}>;
		}>;
		Assets: Array<{
			Asset: Array<{
				$: {
					Type: string;
					Path: string;
					Addressable?: string;
				};
			}>;
		}>;
	};
}

interface ZipCentralDirectory {
	signature: number;
	versionMadeBy: number;
	versionNeeded: number;
	flags: number;
	compressionMethod: number;
	modTime: number;
	modDate: number;
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	fileNameLength: number;
	extraFieldLength: number;
	fileCommentLength: number;
	diskStart: number;
	internalAttributes: number;
	externalAttributes: number;
	localHeaderOffset: number;
	fileName: string;
	extraField: Buffer;
	fileComment: string;
}

interface ZipLocalHeader {
	signature: number;
	versionNeeded: number;
	flags: number;
	compressionMethod: number;
	modTime: number;
	modDate: number;
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	fileNameLength: number;
	extraFieldLength: number;
	fileName: string;
	extraField: Buffer;
}

export class VsixParser {
	private filePath: string;
	private fileBuffer?: Buffer;
	private centralDirectory: ZipCentralDirectory[] = [];

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	async parse(): Promise<{
		packageJson: VsixPackageJson | null;
		manifest: VsixManifest | null;
		fileSize: number;
		lastModified: Date;
	}> {
		const stats = await stat(this.filePath);
		this.fileBuffer = await readFile(this.filePath);

		// Parse ZIP central directory
		await this.parseCentralDirectory();

		// Extract package.json
		const packageJson = await this.extractPackageJson();

		// Extract manifest
		const manifest = await this.extractManifest();

		return {
			packageJson,
			manifest,
			fileSize: stats.size,
			lastModified: stats.mtime
		};
	}

	async extractIcon(iconPath: string): Promise<Buffer | null> {
		if (!this.fileBuffer || !this.centralDirectory.length) {
			await this.parseCentralDirectory();
		}

		// Find the icon file in the ZIP
		const iconEntry = this.centralDirectory.find(entry =>
			entry.fileName === iconPath || entry.fileName === `extension/${iconPath}`
		);

		if (!iconEntry) {
			return null;
		}

		try {
			return await this.extractFile(iconEntry);
		} catch (error) {
			console.error(`Error extracting icon ${iconPath}:`, error);
			return null;
		}
	}

	async extractReadme(): Promise<string | null> {
		if (!this.fileBuffer || !this.centralDirectory.length) {
			await this.parseCentralDirectory();
		}

		// Look for README.md in common locations
		const readmeEntry = this.centralDirectory.find(entry => {
			const fileName = entry.fileName.toLowerCase();
			return fileName === 'readme.md' || 
				   fileName === 'extension/readme.md' || 
				   fileName.endsWith('/readme.md');
		});

		if (!readmeEntry) {
			return null;
		}

		try {
			const readmeBuffer = await this.extractFile(readmeEntry);
			return readmeBuffer.toString('utf8');
		} catch (error) {
			console.error('Error extracting README.md:', error);
			return null;
		}
	}

	async extractChangelog(): Promise<string | null> {
		if (!this.fileBuffer || !this.centralDirectory.length) {
			await this.parseCentralDirectory();
		}

		// Look for CHANGELOG.md in common locations
		const changelogEntry = this.centralDirectory.find(entry => {
			const fileName = entry.fileName.toLowerCase();
			return fileName === 'changelog.md' || 
				   fileName === 'extension/changelog.md' || 
				   fileName.endsWith('/changelog.md') ||
				   fileName === 'changes.md' ||
				   fileName === 'extension/changes.md';
		});

		if (!changelogEntry) {
			return null;
		}

		try {
			const changelogBuffer = await this.extractFile(changelogEntry);
			return changelogBuffer.toString('utf8');
		} catch (error) {
			console.error('Error extracting CHANGELOG.md:', error);
			return null;
		}
	}

	private async parseCentralDirectory(): Promise<void> {
		if (!this.fileBuffer) {
			throw new Error('File buffer not loaded');
		}

		// Find End of Central Directory Record
		const eocdSignature = 0x06054b50;
		let eocdOffset = -1;

		// Search from the end of file backwards
		for (let i = this.fileBuffer.length - 22; i >= 0; i--) {
			if (this.fileBuffer.readUInt32LE(i) === eocdSignature) {
				eocdOffset = i;
				break;
			}
		}

		if (eocdOffset === -1) {
			throw new Error('End of Central Directory not found');
		}

		// Parse End of Central Directory Record
		const totalEntries = this.fileBuffer.readUInt16LE(eocdOffset + 10);
		const centralDirSize = this.fileBuffer.readUInt32LE(eocdOffset + 12);
		const centralDirOffset = this.fileBuffer.readUInt32LE(eocdOffset + 16);

		// Parse Central Directory entries
		let currentOffset = centralDirOffset;
		this.centralDirectory = [];

		for (let i = 0; i < totalEntries; i++) {
			const entry = this.parseCentralDirectoryEntry(currentOffset);
			this.centralDirectory.push(entry);
			currentOffset += 46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
		}
	}

	private parseCentralDirectoryEntry(offset: number): ZipCentralDirectory {
		if (!this.fileBuffer) {
			throw new Error('File buffer not loaded');
		}

		const signature = this.fileBuffer.readUInt32LE(offset);
		if (signature !== 0x02014b50) {
			throw new Error(`Invalid central directory signature: 0x${signature.toString(16)}`);
		}

		const entry: ZipCentralDirectory = {
			signature,
			versionMadeBy: this.fileBuffer.readUInt16LE(offset + 4),
			versionNeeded: this.fileBuffer.readUInt16LE(offset + 6),
			flags: this.fileBuffer.readUInt16LE(offset + 8),
			compressionMethod: this.fileBuffer.readUInt16LE(offset + 10),
			modTime: this.fileBuffer.readUInt16LE(offset + 12),
			modDate: this.fileBuffer.readUInt16LE(offset + 14),
			crc32: this.fileBuffer.readUInt32LE(offset + 16),
			compressedSize: this.fileBuffer.readUInt32LE(offset + 20),
			uncompressedSize: this.fileBuffer.readUInt32LE(offset + 24),
			fileNameLength: this.fileBuffer.readUInt16LE(offset + 28),
			extraFieldLength: this.fileBuffer.readUInt16LE(offset + 30),
			fileCommentLength: this.fileBuffer.readUInt16LE(offset + 32),
			diskStart: this.fileBuffer.readUInt16LE(offset + 34),
			internalAttributes: this.fileBuffer.readUInt16LE(offset + 36),
			externalAttributes: this.fileBuffer.readUInt32LE(offset + 38),
			localHeaderOffset: this.fileBuffer.readUInt32LE(offset + 42),
			fileName: '',
			extraField: Buffer.alloc(0),
			fileComment: ''
		};

		// Read variable length fields
		let varOffset = offset + 46;

		// File name
		entry.fileName = this.fileBuffer.subarray(varOffset, varOffset + entry.fileNameLength).toString('utf8');
		varOffset += entry.fileNameLength;

		// Extra field
		entry.extraField = this.fileBuffer.subarray(varOffset, varOffset + entry.extraFieldLength);
		varOffset += entry.extraFieldLength;

		// File comment
		entry.fileComment = this.fileBuffer.subarray(varOffset, varOffset + entry.fileCommentLength).toString('utf8');

		return entry;
	}

	private async extractFile(entry: ZipCentralDirectory): Promise<Buffer> {
		if (!this.fileBuffer) {
			throw new Error('File buffer not loaded');
		}

		// Parse local file header
		const localHeader = this.parseLocalHeader(entry.localHeaderOffset);

		// Calculate data offset
		const dataOffset = entry.localHeaderOffset + 30 + localHeader.fileNameLength + localHeader.extraFieldLength;

		// Extract compressed data
		const compressedData = this.fileBuffer.subarray(dataOffset, dataOffset + entry.compressedSize);

		// Decompress if needed
		if (entry.compressionMethod === 0) {
			// No compression
			return compressedData;
		} else if (entry.compressionMethod === 8) {
			// Deflate compression
			return await this.inflateData(compressedData);
		} else {
			throw new Error(`Unsupported compression method: ${entry.compressionMethod}`);
		}
	}

	private parseLocalHeader(offset: number): ZipLocalHeader {
		if (!this.fileBuffer) {
			throw new Error('File buffer not loaded');
		}

		const signature = this.fileBuffer.readUInt32LE(offset);
		if (signature !== 0x04034b50) {
			throw new Error(`Invalid local header signature: 0x${signature.toString(16)}`);
		}

		const fileNameLength = this.fileBuffer.readUInt16LE(offset + 26);
		const extraFieldLength = this.fileBuffer.readUInt16LE(offset + 28);

		const header: ZipLocalHeader = {
			signature,
			versionNeeded: this.fileBuffer.readUInt16LE(offset + 4),
			flags: this.fileBuffer.readUInt16LE(offset + 6),
			compressionMethod: this.fileBuffer.readUInt16LE(offset + 8),
			modTime: this.fileBuffer.readUInt16LE(offset + 10),
			modDate: this.fileBuffer.readUInt16LE(offset + 12),
			crc32: this.fileBuffer.readUInt32LE(offset + 14),
			compressedSize: this.fileBuffer.readUInt32LE(offset + 18),
			uncompressedSize: this.fileBuffer.readUInt32LE(offset + 22),
			fileNameLength,
			extraFieldLength,
			fileName: this.fileBuffer.subarray(offset + 30, offset + 30 + fileNameLength).toString('utf8'),
			extraField: this.fileBuffer.subarray(offset + 30 + fileNameLength, offset + 30 + fileNameLength + extraFieldLength)
		};

		return header;
	}

	private async inflateData(compressedData: Buffer): Promise<Buffer> {
		return new Promise((resolve, reject) => {
			zlib.inflateRaw(compressedData, (err, result) => {
				if (err) {
					reject(err);
				} else {
					resolve(result);
				}
			});
		});
	}

	private async extractPackageJson(): Promise<VsixPackageJson | null> {
		const packageEntry = this.centralDirectory.find(entry =>
			entry.fileName === 'extension/package.json' || entry.fileName === 'package.json'
		);

		if (!packageEntry) {
			console.warn('package.json not found in VSIX file');
			return null;
		}

		try {
			const packageBuffer = await this.extractFile(packageEntry);
			const packageText = packageBuffer.toString('utf8');
			return JSON.parse(packageText) as VsixPackageJson;
		} catch (error) {
			console.error('Error parsing package.json:', error);
			return null;
		}
	}

	private async extractManifest(): Promise<VsixManifest | null> {
		const manifestEntry = this.centralDirectory.find(entry =>
			entry.fileName === 'extension.vsixmanifest' ||
			entry.fileName === '[Content_Types].xml' ||
			entry.fileName.endsWith('.vsixmanifest')
		);

		if (!manifestEntry) {
			console.warn('Manifest not found in VSIX file');
			return null;
		}

		try {
			const manifestBuffer = await this.extractFile(manifestEntry);
			const manifestText = manifestBuffer.toString('utf8');

			// Simple XML parsing for VSIX manifest
			// This is a basic implementation - you might want to use a proper XML parser
			return this.parseManifestXml(manifestText);
		} catch (error) {
			console.error('Error parsing manifest:', error);
			return null;
		}
	}

	private parseManifestXml(xmlText: string): VsixManifest | null {
		try {
			// This is a simplified XML parser for VSIX manifests
			// In production, you might want to use a proper XML parsing library
			const manifest: VsixManifest = {
				PackageManifest: {
					Metadata: [],
					Installation: [],
					Assets: []
				}
			};

			// Extract Identity information
			const identityMatch = xmlText.match(/<Identity[^>]+>/);
			if (identityMatch) {
				const identityTag = identityMatch[0];
				const idMatch = identityTag.match(/Id="([^"]+)"/);
				const versionMatch = identityTag.match(/Version="([^"]+)"/);
				const publisherMatch = identityTag.match(/Publisher="([^"]+)"/);
				const languageMatch = identityTag.match(/Language="([^"]+)"/);

				if (idMatch && versionMatch && publisherMatch) {
					manifest.PackageManifest.Metadata.push({
						Identity: [{
							$: {
								Id: idMatch[1],
								Version: versionMatch[1],
								Publisher: publisherMatch[1],
								Language: languageMatch ? languageMatch[1] : 'en-US'
							}
						}],
						DisplayName: [],
						Description: []
					});
				}
			}

			// Extract DisplayName
			const displayNameMatch = xmlText.match(/<DisplayName>([^<]+)<\/DisplayName>/);
			if (displayNameMatch && manifest.PackageManifest.Metadata[0]) {
				manifest.PackageManifest.Metadata[0].DisplayName.push(displayNameMatch[1]);
			}

			// Extract Description
			const descriptionMatch = xmlText.match(/<Description[^>]*>([^<]+)<\/Description>/);
			if (descriptionMatch && manifest.PackageManifest.Metadata[0]) {
				manifest.PackageManifest.Metadata[0].Description.push({
					_: descriptionMatch[1]
				});
			}

			// Extract Categories
			const categoriesMatch = xmlText.match(/<Categories>([^<]+)<\/Categories>/);
			if (categoriesMatch && manifest.PackageManifest.Metadata[0]) {
				manifest.PackageManifest.Metadata[0].Categories = [categoriesMatch[1]];
			}

			// Extract Installation targets
			const installationTargetMatch = xmlText.match(/<InstallationTarget[^>]+>/);
			if (installationTargetMatch) {
				const targetTag = installationTargetMatch[0];
				const idMatch = targetTag.match(/Id="([^"]+)"/);
				const versionMatch = targetTag.match(/Version="([^"]+)"/);

				if (idMatch && versionMatch) {
					manifest.PackageManifest.Installation.push({
						InstallationTarget: [{
							$: {
								Id: idMatch[1],
								Version: versionMatch[1]
							}
						}]
					});
				}
			}

			// Extract Assets
			const assetMatches = xmlText.match(/<Asset[^>]+>/g);
			if (assetMatches) {
				const assets = assetMatches.map(assetTag => {
					const typeMatch = assetTag.match(/Type="([^"]+)"/);
					const pathMatch = assetTag.match(/Path="([^"]+)"/);
					const addressableMatch = assetTag.match(/Addressable="([^"]+)"/);

					return {
						$: {
							Type: typeMatch ? typeMatch[1] : '',
							Path: pathMatch ? pathMatch[1] : '',
							Addressable: addressableMatch ? addressableMatch[1] : undefined
						}
					};
				});

				manifest.PackageManifest.Assets.push({ Asset: assets });
			}

			return manifest;
		} catch (error) {
			console.error('Error parsing manifest XML:', error);
			return null;
		}
	}

	static getMimeTypeFromExtension(ext: string): string {
		const mimeTypes: { [key: string]: string } = {
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.jpeg': 'image/jpeg',
			'.gif': 'image/gif',
			'.svg': 'image/svg+xml',
			'.webp': 'image/webp',
			'.bmp': 'image/bmp',
			'.ico': 'image/x-icon'
		};

		return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
	}
}
