import { Injectable } from '../../shared/decorators/Injectable';
import { ParsingError } from '../../shared/errors/ExtensionError';

@Injectable()
export class ManifestParser {
	parse(xmlText: string): any {
		try {
			// Simple XML parsing for VSIX manifests
			const manifest: any = {
				identity: {},
				displayName: '',
				description: '',
				categories: [],
				tags: [],
				properties: {}
			};

			// Extract Identity information
			const identityMatch = xmlText.match(/<Identity[^>]+>/);
			if (identityMatch) {
				const identityTag = identityMatch[0];
				const idMatch = identityTag.match(/Id="([^"]+)"/);
				const versionMatch = identityTag.match(/Version="([^"]+)"/);
				const publisherMatch = identityTag.match(/Publisher="([^"]+)"/);
				const languageMatch = identityTag.match(/Language="([^"]+)"/);

				if (idMatch) manifest.identity.id = idMatch[1];
				if (versionMatch) manifest.identity.version = versionMatch[1];
				if (publisherMatch) manifest.identity.publisher = publisherMatch[1];
				if (languageMatch) manifest.identity.language = languageMatch[1];
			}

			// Extract DisplayName
			const displayNameMatch = xmlText.match(/<DisplayName>([^<]+)<\/DisplayName>/);
			if (displayNameMatch) {
				manifest.displayName = displayNameMatch[1];
			}

			// Extract Description
			const descriptionMatch = xmlText.match(/<Description[^>]*>([^<]+)<\/Description>/);
			if (descriptionMatch) {
				manifest.description = descriptionMatch[1];
			}

			// Extract Categories
			const categoriesMatch = xmlText.match(/<Categories>([^<]+)<\/Categories>/);
			if (categoriesMatch) {
				manifest.categories = categoriesMatch[1].split(',').map((cat: string) => cat.trim());
			}

			// Extract Tags
			const tagsMatch = xmlText.match(/<Tags>([^<]+)<\/Tags>/);
			if (tagsMatch) {
				manifest.tags = tagsMatch[1].split(',').map((tag: string) => tag.trim());
			}

			// Extract Properties
			const propertiesMatches = xmlText.match(/<Property[^>]+>/g);
			if (propertiesMatches) {
				propertiesMatches.forEach(propTag => {
					const idMatch = propTag.match(/Id="([^"]+)"/);
					const valueMatch = propTag.match(/Value="([^"]+)"/);

					if (idMatch && valueMatch) {
						manifest.properties[idMatch[1]] = valueMatch[1];
					}
				});
			}

			return manifest;
		} catch (error) {
			throw new ParsingError('Failed to parse VSIX manifest', error as Error);
		}
	}
}
