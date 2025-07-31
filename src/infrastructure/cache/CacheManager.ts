import { Injectable } from '../../shared/decorators/Injectable';
import { Logger } from '../../shared/utils/Logger';

export interface CacheEntry<T> {
	value: T;
	timestamp: Date;
	ttl?: number; // time to live in milliseconds
}

@Injectable()
export class CacheManager<T> {
	private cache = new Map<string, CacheEntry<T>>();
	private logger: Logger;

	constructor(private readonly defaultTtl: number = 5 * 60 * 1000) { // 5 minutes default
		this.logger = new Logger('CacheManager');
	}

	set(key: string, value: T, ttl?: number): void {
		const entry: CacheEntry<T> = {
			value,
			timestamp: new Date(),
			ttl: ttl || this.defaultTtl
		};

		this.cache.set(key, entry);
		this.logger.debug(`Cache set: ${key}`);
	}

	get(key: string): T | null {
		const entry = this.cache.get(key);

		if (!entry) {
			this.logger.debug(`Cache miss: ${key}`);
			return null;
		}

		if (this.isExpired(entry)) {
			this.cache.delete(key);
			this.logger.debug(`Cache expired: ${key}`);
			return null;
		}

		this.logger.debug(`Cache hit: ${key}`);
		return entry.value;
	}

	has(key: string): boolean {
		const entry = this.cache.get(key);

		if (!entry) {
			return false;
		}

		if (this.isExpired(entry)) {
			this.cache.delete(key);
			return false;
		}

		return true;
	}

	delete(key: string): boolean {
		const deleted = this.cache.delete(key);
		if (deleted) {
			this.logger.debug(`Cache deleted: ${key}`);
		}
		return deleted;
	}

	clear(): void {
		const size = this.cache.size;
		this.cache.clear();
		this.logger.debug(`Cache cleared: ${size} entries removed`);
	}

	getAll(): T[] {
		const values: T[] = [];
		const expiredKeys: string[] = [];

		for (const [key, entry] of this.cache) {
			if (this.isExpired(entry)) {
				expiredKeys.push(key);
			} else {
				values.push(entry.value);
			}
		}

		// Clean up expired entries
		expiredKeys.forEach(key => this.cache.delete(key));

		if (expiredKeys.length > 0) {
			this.logger.debug(`Removed ${expiredKeys.length} expired cache entries`);
		}

		return values;
	}

	size(): number {
		return this.cache.size;
	}

	keys(): string[] {
		return Array.from(this.cache.keys());
	}

	cleanup(): void {
		const expiredKeys: string[] = [];

		for (const [key, entry] of this.cache) {
			if (this.isExpired(entry)) {
				expiredKeys.push(key);
			}
		}

		expiredKeys.forEach(key => this.cache.delete(key));

		if (expiredKeys.length > 0) {
			this.logger.debug(`Cleanup removed ${expiredKeys.length} expired entries`);
		}
	}

	private isExpired(entry: CacheEntry<T>): boolean {
		if (!entry.ttl) {
			return false; // No expiration
		}

		const now = new Date().getTime();
		const entryTime = entry.timestamp.getTime();
		return (now - entryTime) > entry.ttl;
	}

	// Start periodic cleanup
	startPeriodicCleanup(intervalMs: number = 60000): NodeJS.Timeout {
		return setInterval(() => {
			this.cleanup();
		}, intervalMs);
	}
}
