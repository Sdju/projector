export interface ProcessInfo {
  pid: number;
  parent: number;
  name: string;
  started: string;
  state: string;
  group: number;
  foreground: number;
}

export interface DesktopPalette {
  show(): Promise<void>;
  toggle(): Promise<void>;
  invokeSelected(toggle?: boolean): Promise<void>;
  openPage(path: string): void;
  quitProjector(): Promise<void>;
  restartProjector(): Promise<void>;
  dispose(): void;
}

export interface ResidentOptions {
  dataDirectory: string;
  createPalette(baseUrl: string): Promise<DesktopPalette>;
}
