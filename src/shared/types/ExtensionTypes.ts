import { Extension } from '../../core/domain/entities/Extension';

export interface SearchCriteria {
	query?: string;
	category?: string;
	author?: string;
	isInstalled?: boolean;
	hasUpdate?: boolean;
}

export interface SortOptions {
	sortBy: SortBy;
	sortOrder: SortOrder;
}

export type SortBy = 'name' | 'author' | 'version' | 'lastModified' | 'fileSize';
export type SortOrder = 'ascending' | 'descending';

export interface ExtensionListItem {
	id: string;
	title: string;
	description: string;
	icon: string | null;
	author: string;
	version: string;
	isInstalled: boolean;
	hasUpdate: boolean;
	categories?: string[];
	fileSize?: number;
	lastModified?: Date;
}

export interface ExtensionStats {
	total: number;
	installed: number;
	needsUpdate: number;
	byCategory: Record<string, number>;
	byAuthor: Record<string, number>;
	totalSize: number;
}

export interface InstallationProgress {
	extensionId: string;
	status: 'installing' | 'installed' | 'failed';
	message?: string;
}

export interface ExtensionFilter {
	showInstalled: boolean;
	showNotInstalled: boolean;
	showWithUpdates: boolean;
	selectedCategories: string[];
	selectedAuthors: string[];
}

// Event payload types
export interface ExtensionEventPayload {
	extension?: Extension;
	extensions?: Extension[];
	extensionId?: string;
	directoryPath?: string;
	error?: Error;
	message?: string;
}
