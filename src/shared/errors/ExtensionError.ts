export abstract class ExtensionError extends Error {
	abstract readonly code: string;
	abstract readonly category: ErrorCategory;

	constructor(message: string, public readonly cause?: Error) {
		super(message);
		this.name = this.constructor.name;

		if (cause) {
			this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
		}
	}
}

export enum ErrorCategory {
	VALIDATION = 'validation',
	FILESYSTEM = 'filesystem',
	PARSING = 'parsing',
	INSTALLATION = 'installation',
	NETWORK = 'network',
	CONFIGURATION = 'configuration',
	UNKNOWN = 'unknown'
}

export class ValidationError extends ExtensionError {
	readonly code = 'VALIDATION_ERROR';
	readonly category = ErrorCategory.VALIDATION;
}

export class FileSystemError extends ExtensionError {
	readonly code = 'FILESYSTEM_ERROR';
	readonly category = ErrorCategory.FILESYSTEM;
}

export class ParsingError extends ExtensionError {
	readonly code = 'PARSING_ERROR';
	readonly category = ErrorCategory.PARSING;
}

export class InstallationError extends ExtensionError {
	readonly code = 'INSTALLATION_ERROR';
	readonly category = ErrorCategory.INSTALLATION;
}

export class ConfigurationError extends ExtensionError {
	readonly code = 'CONFIGURATION_ERROR';
	readonly category = ErrorCategory.CONFIGURATION;
}
