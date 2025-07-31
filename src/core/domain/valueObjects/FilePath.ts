import * as path from 'path';
import * as fs from 'fs';

export class FilePath {
	private readonly _path: string;

	constructor(filePath: string) {
		this.validatePath(filePath);
		this._path = path.resolve(filePath);
	}

	get value(): string {
		return this._path;
	}

	get directory(): string {
		return path.dirname(this._path);
	}

	get filename(): string {
		return path.basename(this._path);
	}

	get extension(): string {
		return path.extname(this._path);
	}

	get basename(): string {
		return path.basename(this._path, this.extension);
	}

	exists(): boolean {
		try {
			return fs.existsSync(this._path);
		} catch {
			return false;
		}
	}

	isFile(): boolean {
		try {
			return fs.statSync(this._path).isFile();
		} catch {
			return false;
		}
	}

	getSize(): number {
		try {
			return fs.statSync(this._path).size;
		} catch {
			return 0;
		}
	}

	getLastModified(): Date {
		try {
			return fs.statSync(this._path).mtime;
		} catch {
			return new Date(0);
		}
	}

	equals(other: FilePath): boolean {
		return this._path === other._path;
	}

	toString(): string {
		return this._path;
	}

	private validatePath(filePath: string): void {
		if (!filePath || typeof filePath !== 'string') {
			throw new Error('File path must be a non-empty string');
		}

		if (path.extname(filePath).toLowerCase() !== '.vsix') {
			throw new Error('File path must point to a .vsix file');
		}
	}
}
