export type DesktopAction = "show" | "toggle" | "tray" | "quit";

export interface ProcessInfo {
  pid: number;
  parent: number;
  name: string;
  started: string;
  state: string;
  /** Process group and terminal foreground group. Absent where the OS has no such concept. */
  group: number | null;
  foreground: number | null;
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

/** Identifies one entry in the OS secret store. */
export interface SecretKey {
  service: string;
  account: string;
}

/** How a host shell should be started. Containers keep their own `/bin/bash` argv. */
export type ShellLaunch =
  | { kind: "interactive" }
  | { kind: "command"; command: string }
  | { kind: "program"; executable: string };

export type {
  AgentProcessSpec,
  AgentLaunch,
  AgentHostSpec,
  AgentProcess,
  AskpassSpec,
  AskpassScript,
} from "../os-posix/index.ts";
