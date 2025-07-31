import { Injectable } from '../../shared/decorators/Injectable';
import { IVsixParser } from '../../core/domain/interfaces/IVsixParser';
import { Extension } from '../../core/domain/entities/Extension';
import { ExtensionId } from '../../core/domain/valueObjects/ExtensionId';
import { Version } from '../../core/domain/valueObjects/Version';
import { FilePath } from '../../core/domain/valueObjects/FilePath';
import { ExtensionMetadata, ExtensionMetadataBuilder } from '../../core/domain/entities/ExtensionMetadata';
import { Logger } from '../../shared/utils/Logger';
import { ParsingError } from '../../shared/errors/ExtensionError';
import { ManifestParser } from './ManifestParser';
import { PackageJsonParser } from './PackageJsonParser';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const inflateRaw = promisify(zlib.inflateRaw);

interface ZipEntry {
	fileName: string;
	compressedSize: number;
	uncompressedSize: number;
	compressionMethod: number;
	localHeaderOffset: number;
	crc32: number;
}

@Injectable()
export class VsixParser implements IVsixParser {
	private fileBuffer?: Buffer;
	private zipEntries: ZipEntry[] = [];

	constructor(
		private readonly logger: Logger,
		private readonly manifestParser: ManifestParser = new ManifestParser(),
		private readonly packageJsonParser: PackageJsonParser = new PackageJsonParser()
	) { }

	async parse(filePath: FilePath): Promise<Extension | null> {
		try {
			this.logger.debug(`Parsing VSIX file: ${filePath.value}`);

			// Validate file first
			if (!await this.validate(filePath)) {
				throw new ParsingError(`Invalid VSIX file: ${filePath.value}`);
			}

			// Load and parse ZIP structure
			this.fileBuffer = await readFile(filePath.value);
			await this.parseZipStructure();

			// Extract and parse package.json
			const packageJsonData = await this.extractAndParsePackageJson();
			if (!packageJsonData) {
				throw new ParsingError('No valid package.json found in VSIX file');
			}

			// Extract and parse manifest
			const manifestData = await this.extractAndParseManifest();

			// Build extension metadata
			const metadata = this.buildExtensionMetadata(packageJsonData, manifestData);

			// Extract additional content
			const readme = await this.extractReadme(filePath);
			const changelog = await this.extractChangelog(filePath);
			if (readme) metadata.readme = readme;
			if (changelog) metadata.changelog = changelog;

			// Create extension entity
			const extensionId = new ExtensionId(`${metadata.publisher}.${packageJsonData.name}`);
			const version = new Version(packageJsonData.version);

			const extension = new Extension(
				extensionId,
				metadata,
				filePath,
				version
			);

			this.logger.debug(`Successfully parsed extension: ${extension.id.value}`);
			return extension;

		} catch (error) {
			this.logger.error(`Failed to parse VSIX file: ${filePath.value}`, { error });
			if (error instanceof ParsingError) {
				throw error;
			}
			throw new ParsingError(`Failed to parse VSIX file: ${filePath.value}`, error as Error);
		} finally {
			this.cleanup();
		}
	}

	async validate(filePath: FilePath): Promise<boolean> {
		try {
			if (!filePath.exists()) {
				return false;
			}

			if (!filePath.isFile()) {
				return false;
			}

			if (filePath.extension.toLowerCase() !== '.vsix') {
				return false;
			}

			if (filePath.getSize() === 0) {
				return false;
			}

			// Basic ZIP file validation
			const buffer = await readFile(filePath.value);
			return this.isValidZipFile(buffer);

		} catch (error) {
			this.logger.warn(`Validation failed for: ${filePath.value}`, { error });
			return false;
		}
	}

	async extractIcon(filePath: FilePath, iconPath: string): Promise<Buffer | null> {
		try {
			if (!this.fileBuffer) {
				this.fileBuffer = await readFile(filePath.value);
				await this.parseZipStructure();
			}

			const iconEntry = this.findZipEntry(iconPath) || this.findZipEntry(`extension/${iconPath}`);
			if (!iconEntry) {
				return null;
			}

			return await this.extractFileFromZip(iconEntry);
		} catch (error) {
			this.logger.warn(`Failed to extract icon: ${iconPath}`, { error });
			return null;
		}
	}

	async extractReadme(filePath: FilePath): Promise<string | null> {
		try {
			if (!this.fileBuffer) {
				this.fileBuffer = await readFile(filePath.value);
				await this.parseZipStructure();
			}

			const readmeEntry = this.findZipEntry('readme.md') ||
				this.findZipEntry('extension/readme.md') ||
				this.findZipEntry('README.md') ||
				this.findZipEntry('extension/README.md');

			if (!readmeEntry) {
				return null;
			}

			const buffer = await this.extractFileFromZip(readmeEntry);
			return buffer.toString('utf8');
		} catch (error) {
			this.logger.warn('Failed to extract README', { error });
			return null;
		}
	}

	async extractChangelog(filePath: FilePath): Promise<string | null> {
		try {
			if (!this.fileBuffer) {
				this.fileBuffer = await readFile(filePath.value);
				await this.parseZipStructure();
			}

			const changelogEntry = this.findZipEntry('changelog.md') ||
				this.findZipEntry('extension/changelog.md') ||
				this.findZipEntry('CHANGELOG.md') ||
				this.findZipEntry('extension/CHANGELOG.md') ||
				this.findZipEntry('changes.md') ||
				this.findZipEntry('extension/changes.md');

			if (!changelogEntry) {
				return null;
			}

			const buffer = await this.extractFileFromZip(changelogEntry);
			return buffer.toString('utf8');
		} catch (error) {
			this.logger.warn('Failed to extract CHANGELOG', { error });
			return null;
		}
	}

	private async parseZipStructure(): Promise<void> {
		if (!this.fileBuffer) {
			throw new ParsingError('File buffer not loaded');
		}

		// Find End of Central Directory Record
		const eocdOffset = this.findEndOfCentralDirectory();
		if (eocdOffset === -1) {
			throw new ParsingError('Invalid ZIP file: End of Central Directory not found');
		}

		// Parse central directory
		const totalEntries = this.fileBuffer.readUInt16LE(eocdOffset + 10);
		const centralDirOffset = this.fileBuffer.readUInt32LE(eocdOffset + 16);

		this.zipEntries = [];
		let currentOffset = centralDirOffset;

		for (let i = 0; i < totalEntries; i++) {
			const entry = this.parseCentralDirectoryEntry(currentOffset);
			this.zipEntries.push(entry);
			currentOffset += 46 + entry.fileName.length + this.getExtraFieldLength(currentOffset) + this.getFileCommentLength(currentOffset);
		}
	}

	private findEndOfCentralDirectory(): number {
		if (!this.fileBuffer) return -1;

		const eocdSignature = 0x06054b50;
		for (let i = this.fileBuffer.length - 22; i >= 0; i--) {
			if (this.fileBuffer.readUInt32LE(i) === eocdSignature) {
				return i;
			}
		}
		return -1;
	}

	private parseCentralDirectoryEntry(offset: number): ZipEntry {
		if (!this.fileBuffer) {
			throw new ParsingError('File buffer not loaded');
		}

		const signature = this.fileBuffer.readUInt32LE(offset);
		if (signature !== 0x02014b50) {
			throw new ParsingError(`Invalid central directory signature: 0x${signature.toString(16)}`);
		}

		const compressionMethod = this.fileBuffer.readUInt16LE(offset + 10);
		const crc32 = this.fileBuffer.readUInt32LE(offset + 16);
		const compressedSize = this.fileBuffer.readUInt32LE(offset + 20);
		const uncompressedSize = this.fileBuffer.readUInt32LE(offset + 24);
		const fileNameLength = this.fileBuffer.readUInt16LE(offset + 28);
		const localHeaderOffset = this.fileBuffer.readUInt32LE(offset + 42);

		const fileName = this.fileBuffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

		return {
			fileName,
			compressedSize,
			uncompressedSize,
			compressionMethod,
			localHeaderOffset,
			crc32
		};
	}

	private getExtraFieldLength(offset: number): number {
		return this.fileBuffer ? this.fileBuffer.readUInt16LE(offset + 30) : 0;
	}

	private getFileCommentLength(offset: number): number {
		return this.fileBuffer ? this.fileBuffer.readUInt16LE(offset + 32) : 0;
	}

	private findZipEntry(fileName: string): ZipEntry | undefined {
		return this.zipEntries.find(entry =>
			entry.fileName.toLowerCase() === fileName.toLowerCase()
		);
	}

	private async extractFileFromZip(entry: ZipEntry): Promise<Buffer> {
		if (!this.fileBuffer) {
			throw new ParsingError('File buffer not loaded');
		}

		// Parse local header to get actual data offset
		const localHeaderOffset = entry.localHeaderOffset;
		const fileNameLength = this.fileBuffer.readUInt16LE(localHeaderOffset + 26);
		const extraFieldLength = this.fileBuffer.readUInt16LE(localHeaderOffset + 28);
		const dataOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength;

		// Extract compressed data
		const compressedData = this.fileBuffer.subarray(dataOffset, dataOffset + entry.compressedSize);

		// Decompress if needed
		if (entry.compressionMethod === 0) {
			return compressedData; // No compression
		} else if (entry.compressionMethod === 8) {
			return await inflateRaw(compressedData); // Deflate compression
		} else {
			throw new ParsingError(`Unsupported compression method: ${entry.compressionMethod}`);
		}
	}

	private async extractAndParsePackageJson(): Promise<any> {
		const packageEntry = this.findZipEntry('extension/package.json') || this.findZipEntry('package.json');
		if (!packageEntry) {
			return null;
		}

		const buffer = await this.extractFileFromZip(packageEntry);
		const text = buffer.toString('utf8');
		return this.packageJsonParser.parse(text);
	}

	private async extractAndParseManifest(): Promise<any> {
		const manifestEntry = this.findZipEntry('extension.vsixmanifest') ||
			this.zipEntries.find(entry => entry.fileName.endsWith('.vsixmanifest'));

		if (!manifestEntry) {
			return null;
		}

		const buffer = await this.extractFileFromZip(manifestEntry);
		const text = buffer.toString('utf8');
		return this.manifestParser.parse(text);
	}

	private buildExtensionMetadata(packageJson: any, manifest: any): ExtensionMetadata {
		const builder = new ExtensionMetadataBuilder();

		// Use package.json as primary source, manifest as fallback
		builder
			.displayName(packageJson.displayName || packageJson.name || manifest?.displayName)
			.description(packageJson.description || manifest?.description || '')
			.author(this.extractAuthor(packageJson) || manifest?.publisher || 'Unknown')
			.publisher(packageJson.publisher || manifest?.publisher || 'Unknown');

		if (packageJson.icon) builder.icon(packageJson.icon);
		if (packageJson.categories) builder.categories(packageJson.categories);
		if (packageJson.keywords) builder.keywords(packageJson.keywords);
		if (packageJson.repository) {
			const repo = typeof packageJson.repository === 'string' ?
				packageJson.repository : packageJson.repository?.url;
			if (repo) builder.repository(repo);
		}
		if (packageJson.homepage) builder.homepage(packageJson.homepage);
		if (packageJson.license) builder.license(packageJson.license);
		if (packageJson.engines) builder.engines(packageJson.engines);

		return builder.build();
	}

	private extractAuthor(packageJson: any): string | undefined {
		if (typeof packageJson.author === 'string') {
			return packageJson.author;
		}
		if (packageJson.author && typeof packageJson.author === 'object') {
			return packageJson.author.name;
		}
		return undefined;
	}

	private isValidZipFile(buffer: Buffer): boolean {
		if (buffer.length < 4) return false;

		// Check for ZIP signature
		const signature = buffer.readUInt32LE(0);
		return signature === 0x04034b50; // Local file header signature
	}

	private cleanup(): void {
		this.fileBuffer = undefined;
		this.zipEntries = [];
	}
}
