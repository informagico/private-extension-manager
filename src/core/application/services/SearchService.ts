import { Injectable } from '../../../shared/decorators/Injectable';
import { IExtensionRepository } from '../../domain/interfaces/IExtensionRepository';
import { Extension } from '../../domain/entities/Extension';
import { SearchCriteria } from '../../../shared/types/ExtensionTypes';

@Injectable()
export class SearchService {
	constructor(private readonly repository: IExtensionRepository) { }

	async search(criteria: SearchCriteria): Promise<Extension[]> {
		return await this.repository.search(criteria);
	}

	async searchByText(query: string): Promise<Extension[]> {
		return await this.search({ query });
	}

	async searchByCategory(category: string): Promise<Extension[]> {
		return await this.search({ category });
	}

	async searchInstalled(installed: boolean = true): Promise<Extension[]> {
		return await this.search({ isInstalled: installed });
	}

	async searchWithUpdates(): Promise<Extension[]> {
		return await this.search({ hasUpdate: true });
	}

	async searchByAuthor(author: string): Promise<Extension[]> {
		const allExtensions = await this.repository.findAll();
		return allExtensions.filter(ext =>
			ext.metadata.author.toLowerCase().includes(author.toLowerCase())
		);
	}

	async getPopularCategories(): Promise<Array<{ category: string; count: number }>> {
		const allExtensions = await this.repository.findAll();
		const categoryCount = new Map<string, number>();

		allExtensions.forEach(extension => {
			extension.metadata.categories?.forEach(category => {
				categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
			});
		});

		return Array.from(categoryCount.entries())
			.map(([category, count]) => ({ category, count }))
			.sort((a, b) => b.count - a.count);
	}

	async getStatistics(): Promise<{
		total: number;
		installed: number;
		needsUpdate: number;
		categories: number;
		authors: number;
	}> {
		const allExtensions = await this.repository.findAll();
		const categories = new Set<string>();
		const authors = new Set<string>();

		allExtensions.forEach(extension => {
			extension.metadata.categories?.forEach(cat => categories.add(cat));
			authors.add(extension.metadata.author);
		});

		return {
			total: allExtensions.length,
			installed: allExtensions.filter(ext => ext.isInstalled).length,
			needsUpdate: allExtensions.filter(ext => ext.hasUpdate).length,
			categories: categories.size,
			authors: authors.size
		};
	}
}
