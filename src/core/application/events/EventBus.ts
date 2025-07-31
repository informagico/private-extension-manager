import { Injectable } from '../../../shared/decorators/Injectable';
import { ExtensionEvent } from './ExtensionEvent';
import { Logger } from '../../../shared/utils/Logger';

type EventHandler<T = any> = (event: ExtensionEvent<T>) => void | Promise<void>;

@Injectable()
export class EventBus {
	private handlers = new Map<string, EventHandler[]>();
	private logger: Logger;

	constructor() {
		this.logger = new Logger('EventBus');
	}

	subscribe<T>(eventType: string, handler: EventHandler<T>): void {
		if (!this.handlers.has(eventType)) {
			this.handlers.set(eventType, []);
		}

		this.handlers.get(eventType)!.push(handler);
		this.logger.debug(`Subscribed to event: ${eventType}`);
	}

	unsubscribe<T>(eventType: string, handler: EventHandler<T>): void {
		const handlers = this.handlers.get(eventType);
		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index > -1) {
				handlers.splice(index, 1);
				this.logger.debug(`Unsubscribed from event: ${eventType}`);
			}
		}
	}

	async emit<T>(event: ExtensionEvent<T>): Promise<void> {
		const handlers = this.handlers.get(event.type);
		if (!handlers || handlers.length === 0) {
			this.logger.debug(`No handlers for event: ${event.type}`);
			return;
		}

		this.logger.debug(`Emitting event: ${event.type}`, { data: event.data });

		const promises = handlers.map(async (handler) => {
			try {
				await handler(event);
			} catch (error) {
				this.logger.error(`Error in event handler for ${event.type}`, { error });
			}
		});

		await Promise.all(promises);
	}

	unsubscribeAll(): void {
		this.handlers.clear();
		this.logger.debug('Unsubscribed from all events');
	}

	getEventTypes(): string[] {
		return Array.from(this.handlers.keys());
	}

	getHandlerCount(eventType: string): number {
		return this.handlers.get(eventType)?.length || 0;
	}
}
