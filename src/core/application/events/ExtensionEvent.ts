export class ExtensionEvent<T = any> {
	public readonly timestamp: Date;

	constructor(
		public readonly type: string,
		public readonly data?: T
	) {
		this.timestamp = new Date();
	}

	toString(): string {
		return `ExtensionEvent(${this.type}) at ${this.timestamp.toISOString()}`;
	}
}

// Event type definitions for better type safety
export type ExtensionEventType =
	| 'extensions-loaded'
	| 'extensions-load-failed'
	| 'extension-selected'
	| 'refresh-started'
	| 'refresh-completed'
	| 'refresh-failed'
	| 'install-started'
	| 'install-completed'
	| 'install-failed'
	| 'uninstall-started'
	| 'uninstall-completed'
	| 'uninstall-failed'
	| 'directory-added'
	| 'directory-removed'
	| 'search-performed'
	| 'file-change-detected';
