import { Injectable } from '../decorators/Injectable';

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3
}

@Injectable()
export class Logger {
	private readonly logLevel: LogLevel;
	private readonly context: string;

	constructor(context: string = 'PrivateExtensionManager', logLevel: LogLevel = LogLevel.INFO) {
		this.context = context;
		this.logLevel = logLevel;
	}

	debug(message: string, data?: any): void {
		if (this.logLevel <= LogLevel.DEBUG) {
			this.log('DEBUG', message, data);
		}
	}

	info(message: string, data?: any): void {
		if (this.logLevel <= LogLevel.INFO) {
			this.log('INFO', message, data);
		}
	}

	warn(message: string, data?: any): void {
		if (this.logLevel <= LogLevel.WARN) {
			this.log('WARN', message, data);
		}
	}

	error(message: string, data?: any): void {
		if (this.logLevel <= LogLevel.ERROR) {
			this.log('ERROR', message, data);
		}
	}

	private log(level: string, message: string, data?: any): void {
		const timestamp = new Date().toISOString();
		const logMessage = `[${timestamp}] [${this.context}] [${level}] ${message}`;

		if (data) {
			console.log(logMessage, data);
		} else {
			console.log(logMessage);
		}
	}

	createChild(childContext: string): Logger {
		return new Logger(`${this.context}:${childContext}`, this.logLevel);
	}
}
