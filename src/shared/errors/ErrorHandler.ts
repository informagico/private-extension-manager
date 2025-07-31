import { Injectable } from '../decorators/Injectable';
import { Logger } from '../utils/Logger';
import { ExtensionError, ErrorCategory } from './ExtensionError';
import * as vscode from 'vscode';

@Injectable()
export class ErrorHandler {
	constructor(private readonly logger: Logger) { }

	handle(error: Error, context?: string): void {
		if (error instanceof ExtensionError) {
			this.handleExtensionError(error, context);
		} else {
			this.handleGenericError(error, context);
		}
	}

	private handleExtensionError(error: ExtensionError, context?: string): void {
		const contextMessage = context ? `[${context}] ` : '';
		const logMessage = `${contextMessage}${error.message}`;

		this.logger.error(logMessage, {
			code: error.code,
			category: error.category,
			cause: error.cause
		});

		const userMessage = this.getUserFriendlyMessage(error);

		switch (error.category) {
			case ErrorCategory.VALIDATION:
			case ErrorCategory.CONFIGURATION:
				vscode.window.showWarningMessage(userMessage);
				break;
			case ErrorCategory.INSTALLATION:
			case ErrorCategory.FILESYSTEM:
			case ErrorCategory.PARSING:
				vscode.window.showErrorMessage(userMessage);
				break;
			default:
				vscode.window.showErrorMessage(`Unexpected error: ${userMessage}`);
		}
	}

	private handleGenericError(error: Error, context?: string): void {
		const contextMessage = context ? `[${context}] ` : '';
		const logMessage = `${contextMessage}${error.message}`;

		this.logger.error(logMessage, { error });
		vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
	}

	private getUserFriendlyMessage(error: ExtensionError): string {
		switch (error.code) {
			case 'VALIDATION_ERROR':
				return `Validation failed: ${error.message}`;
			case 'FILESYSTEM_ERROR':
				return `File system error: ${error.message}`;
			case 'PARSING_ERROR':
				return `Failed to parse extension file: ${error.message}`;
			case 'INSTALLATION_ERROR':
				return `Installation failed: ${error.message}`;
			case 'CONFIGURATION_ERROR':
				return `Configuration error: ${error.message}`;
			default:
				return error.message;
		}
	}

	async handleAsync(operation: () => Promise<void>, context?: string): Promise<void> {
		try {
			await operation();
		} catch (error) {
			this.handle(error as Error, context);
		}
	}

	handleSync(operation: () => void, context?: string): void {
		try {
			operation();
		} catch (error) {
			this.handle(error as Error, context);
		}
	}
}
