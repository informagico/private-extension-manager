import { Injectable } from '../../shared/decorators/Injectable';
import { ParsingError } from '../../shared/errors/ExtensionError';

@Injectable()
export class PackageJsonParser {
	parse(jsonText: string): any {
		try {
			const data = JSON.parse(jsonText);

			// Validate required fields
			if (!data.name) {
				throw new ParsingError('package.json missing required field: name');
			}

			if (!data.version) {
				throw new ParsingError('package.json missing required field: version');
			}

			if (!data.publisher) {
				throw new ParsingError('package.json missing required field: publisher');
			}

			return data;
		} catch (error) {
			if (error instanceof ParsingError) {
				throw error;
			}
			throw new ParsingError('Invalid package.json format', error as Error);
		}
	}
}
