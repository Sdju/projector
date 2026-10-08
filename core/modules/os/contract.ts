import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type DesktopAction = "show" | "toggle" | "tray" | "quit";

/** A long-lived ACP server process a coding agent runs over stdio. */
export interface AgentProcessSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

/** The script that keeps an agent process alive across server restarts, and where it logs. */
export interface AgentHostSpec {
  script: string;
  dir: string;
  address: string;
  env: Record<string, string | undefined>;
  /** File descriptor for the host's own stdout and stderr. */
  log: number;
}

export type AgentProcess = ChildProcessWithoutNullStreams & {
  /** Kills the whole process tree (shell grandchildren included) and waits for exit. */
  terminate(): Promise<void>;
};

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
