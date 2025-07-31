export namespace ConfigurationTypes {
	export type SortBy = 'name' | 'author' | 'lastModified' | 'fileSize' | 'version';
	export type SortOrder = 'ascending' | 'descending';
	export type RestartMethod = 'extensionHost' | 'reloadWindow' | 'prompt';

	export interface ExtensionConfiguration {
		vsixDirectories: string[];
		autoScan: boolean;
		loadAtStartup: boolean;
		scanInterval: number;
		showFileSize: boolean;
		showLastModified: boolean;
		sortBy: SortBy;
		sortOrder: SortOrder;
		autoRestartAfterInstall: boolean;
		restartMethod: RestartMethod;
	}

	export interface UIConfiguration {
		showFileSize: boolean;
		showLastModified: boolean;
		compactMode: boolean;
		showCategories: boolean;
		showKeywords: boolean;
	}

	export interface PerformanceConfiguration {
		cacheTimeout: number;
		maxConcurrentScans: number;
		debounceInterval: number;
		retryAttempts: number;
		retryDelay: number;
	}
}
