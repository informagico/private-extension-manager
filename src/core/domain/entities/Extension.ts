import { ExtensionId } from '../valueObjects/ExtensionId';
import { Version } from '../valueObjects/Version';
import { FilePath } from '../valueObjects/FilePath';
import { ExtensionMetadata } from './ExtensionMetadata';

export class Extension {
	constructor(
		public readonly id: ExtensionId,
		public readonly metadata: ExtensionMetadata,
		public readonly filePath: FilePath,
		public readonly version: Version,
		private _isInstalled: boolean = false,
		private _hasUpdate: boolean = false
	) { }

	get isInstalled(): boolean {
		return this._isInstalled;
	}

	get hasUpdate(): boolean {
		return this._hasUpdate;
	}

	markAsInstalled(): void {
		this._isInstalled = true;
		this._hasUpdate = false;
	}

	markAsUninstalled(): void {
		this._isInstalled = false;
		this._hasUpdate = false;
	}

	markAsHavingUpdate(): void {
		if (this._isInstalled) {
			this._hasUpdate = true;
		}
	}

	clearUpdateFlag(): void {
		this._hasUpdate = false;
	}

	equals(other: Extension): boolean {
		return this.id.equals(other.id) && this.version.equals(other.version);
	}

	isNewerThan(other: Extension): boolean {
		return this.version.isGreaterThan(other.version);
	}
}
