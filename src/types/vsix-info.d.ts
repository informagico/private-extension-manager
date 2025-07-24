declare module 'vsix-info' {
  export interface VsixInfo {
    id: string;
    name: string;
    publisher: string;
    version: string;

    getPackageJson(): Promise<any>; // oppure un tipo più preciso
    getManifest(): Promise<any>;
    getFile(filePath: string): Promise<Buffer>;
  }

  export function getVsixInfo(filePath: string): Promise<VsixInfo>;
}
