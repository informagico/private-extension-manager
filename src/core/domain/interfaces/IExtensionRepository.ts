import { Extension } from '../entities/Extension';
import { ExtensionId } from '../valueObjects/ExtensionId';
import { SearchCriteria } from '../../../shared/types/ExtensionTypes';

export interface IExtensionRepository {
	findAll(): Promise<Extension[]>;
	findById(id: ExtensionId): Promise<Extension | null>;
	search(criteria: SearchCriteria): Promise<Extension[]>;
	refresh(): Promise<Extension[]>;
	addWatchedDirectory(directoryPath: string): Promise<void>;
	removeWatchedDirectory(directoryPath: string): Promise<void>;
	dispose(): void;
}
