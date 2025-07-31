import { Injectable } from '../../../shared/decorators/Injectable';
import { SearchService } from '../services/SearchService';
import { Extension } from '../../domain/entities/Extension';
import { SearchCriteria, SortOptions } from '../../../shared/types/ExtensionTypes';

@Injectable()
export class SearchExtensionsUseCase {
	constructor(private readonly searchService: SearchService) { }

	async execute(criteria: SearchCriteria, sortOptions?: SortOptions): Promise<Extension[]> {
		const results = await this.searchService.search(criteria);

		if (sortOptions) {
			return this.sortResults(results, sortOptions);
		}

		return results;
	}

	private sortResults(extensions: Extension[], options: SortOptions): Extension[] {
		const { sortBy, sortOrder } = options;

		return extensions.sort((a, b) => {
			let comparison = 0;

			switch (sortBy) {
				case 'name':
					comparison = a.metadata.displayName.localeCompare(b.metadata.displayName);
					break;
				case 'author':
					comparison = a.metadata.author.localeCompare(b.metadata.author);
					break;
				case 'version':
					comparison = a.version.isGreaterThan(b.version) ? 1 :
						b.version.isGreaterThan(a.version) ? -1 : 0;
					break;
				case 'lastModified':
					const aTime = a.filePath.getLastModified().getTime();
					const bTime = b.filePath.getLastModified().getTime();
					comparison = aTime - bTime;
					break;
				case 'fileSize':
					comparison = a.filePath.getSize() - b.filePath.getSize();
					break;
				default:
					comparison = a.metadata.displayName.localeCompare(b.metadata.displayName);
			}

			return sortOrder === 'descending' ? -comparison : comparison;
		});
	}
}
