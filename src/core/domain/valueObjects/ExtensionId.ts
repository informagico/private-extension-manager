export class ExtensionId {
	private readonly _value: string;

	constructor(value: string) {
		this.validateFormat(value);
		this._value = value.toLowerCase();
	}

	get value(): string {
		return this._value;
	}

	get publisher(): string {
		return this._value.split('.')[0];
	}

	get name(): string {
		return this._value.split('.')[1];
	}

	equals(other: ExtensionId): boolean {
		return this._value === other._value;
	}

	toString(): string {
		return this._value;
	}

	private validateFormat(value: string): void {
		if (!value || typeof value !== 'string') {
			throw new Error('Extension ID must be a non-empty string');
		}

		const parts = value.split('.');
		if (parts.length !== 2) {
			throw new Error('Extension ID must be in format "publisher.name"');
		}

		const [publisher, name] = parts;
		if (!publisher || !name) {
			throw new Error('Both publisher and name must be non-empty');
		}

		if (!/^[a-zA-Z0-9\-_]+$/.test(publisher) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
			throw new Error('Extension ID can only contain alphanumeric characters, hyphens, and underscores');
		}
	}

	static fromPublisherAndName(publisher: string, name: string): ExtensionId {
		return new ExtensionId(`${publisher}.${name}`);
	}
}
