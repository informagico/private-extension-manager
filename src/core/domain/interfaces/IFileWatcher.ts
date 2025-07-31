export interface IFileWatcher {
	start(): void;
	stop(): void;
	addDirectory(directoryPath: string): void;
	removeDirectory(directoryPath: string): void;
	onFileChange(callback: (eventType: string, filePath: string) => void): void;
	dispose(): void;
}
