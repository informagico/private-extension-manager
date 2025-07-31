import { Extension } from '../entities/Extension';
import { FilePath } from '../valueObjects/FilePath';

export interface IVsixParser {
	parse(filePath: FilePath): Promise<Extension | null>;
	validate(filePath: FilePath): Promise<boolean>;
	extractIcon(filePath: FilePath, iconPath: string): Promise<Buffer | null>;
	extractReadme(filePath: FilePath): Promise<string | null>;
	extractChangelog(filePath: FilePath): Promise<string | null>;
}
