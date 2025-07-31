export interface ExtensionMetadata {
	displayName: string;
	description: string;
	author: string;
	publisher: string;
	icon?: string;
	categories?: string[];
	keywords?: string[];
	repository?: string;
	homepage?: string;
	license?: string;
	engines?: { [key: string]: string };
	activationEvents?: string[];
	main?: string;
	preview?: boolean;
	galleryBanner?: {
		color?: string;
		theme?: string;
	};
	tags?: string[];
	galleryFlags?: string[];
	targetPlatforms?: string[];
	language?: string;
	readme?: string;
	changelog?: string;
}

export class ExtensionMetadataBuilder {
	private metadata: Partial<ExtensionMetadata> = {};

	displayName(name: string): ExtensionMetadataBuilder {
		this.metadata.displayName = name;
		return this;
	}

	description(desc: string): ExtensionMetadataBuilder {
		this.metadata.description = desc;
		return this;
	}

	author(author: string): ExtensionMetadataBuilder {
		this.metadata.author = author;
		return this;
	}

	publisher(publisher: string): ExtensionMetadataBuilder {
		this.metadata.publisher = publisher;
		return this;
	}

	icon(iconPath: string): ExtensionMetadataBuilder {
		this.metadata.icon = iconPath;
		return this;
	}

	categories(categories: string[]): ExtensionMetadataBuilder {
		this.metadata.categories = categories;
		return this;
	}

	keywords(keywords: string[]): ExtensionMetadataBuilder {
		this.metadata.keywords = keywords;
		return this;
	}

	repository(repo: string): ExtensionMetadataBuilder {
		this.metadata.repository = repo;
		return this;
	}

	homepage(homepage: string): ExtensionMetadataBuilder {
		this.metadata.homepage = homepage;
		return this;
	}

	license(license: string): ExtensionMetadataBuilder {
		this.metadata.license = license;
		return this;
	}

	engines(engines: { [key: string]: string }): ExtensionMetadataBuilder {
		this.metadata.engines = engines;
		return this;
	}

	readme(readme: string): ExtensionMetadataBuilder {
		this.metadata.readme = readme;
		return this;
	}

	changelog(changelog: string): ExtensionMetadataBuilder {
		this.metadata.changelog = changelog;
		return this;
	}

	build(): ExtensionMetadata {
		if (!this.metadata.displayName) {
			throw new Error('Display name is required');
		}
		if (!this.metadata.description) {
			throw new Error('Description is required');
		}
		if (!this.metadata.author) {
			throw new Error('Author is required');
		}
		if (!this.metadata.publisher) {
			throw new Error('Publisher is required');
		}

		return this.metadata as ExtensionMetadata;
	}
}
