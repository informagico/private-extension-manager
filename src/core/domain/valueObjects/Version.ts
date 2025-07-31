export class Version {
	private readonly _version: string;
	private readonly _major: number;
	private readonly _minor: number;
	private readonly _patch: number;
	private readonly _prerelease?: string;

	constructor(version: string) {
		this._version = version;
		const parsed = this.parseVersion(version);
		this._major = parsed.major;
		this._minor = parsed.minor;
		this._patch = parsed.patch;
		this._prerelease = parsed.prerelease;
	}

	get value(): string {
		return this._version;
	}

	get major(): number {
		return this._major;
	}

	get minor(): number {
		return this._minor;
	}

	get patch(): number {
		return this._patch;
	}

	get prerelease(): string | undefined {
		return this._prerelease;
	}

	equals(other: Version): boolean {
		return this._version === other._version;
	}

	isGreaterThan(other: Version): boolean {
		if (this._major !== other._major) return this._major > other._major;
		if (this._minor !== other._minor) return this._minor > other._minor;
		if (this._patch !== other._patch) return this._patch > other._patch;

		// Handle prerelease versions
		if (this._prerelease && !other._prerelease) return false;
		if (!this._prerelease && other._prerelease) return true;
		if (this._prerelease && other._prerelease) {
			return this._prerelease > other._prerelease;
		}

		return false;
	}

	private parseVersion(version: string): {
		major: number;
		minor: number;
		patch: number;
		prerelease?: string;
	} {
		const regex = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+(.+))?$/;
		const match = version.match(regex);

		if (!match) {
			throw new Error(`Invalid version format: ${version}`);
		}

		return {
			major: parseInt(match[1], 10),
			minor: parseInt(match[2], 10),
			patch: parseInt(match[3], 10),
			prerelease: match[4]
		};
	}
}
