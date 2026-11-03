import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** A plain child process: the caller owns the command, its arguments and its stdio. */
export interface SpawnProcessSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: ("pipe" | "ignore" | "inherit")[];
  shell?: boolean;
}

/** A long-lived ACP server process a coding agent runs over stdio. */
export interface AgentProcessSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Windows routes `.cmd` shims through a shell by default; an absolute executable can opt out. */
  shell?: boolean;
}

/** An agent command as the OS needs it started: quoted and routed through a shell where required. */
export interface AgentLaunch {
  command: string;
  args: string[];
  shell: boolean;
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

/** Credentials a Git helper answers with; both values end up inside script text. */
export interface AskpassSpec {
  username: string;
  tokenEnv: string;
}

/** A helper script Git runs to ask for a password, and the name it must be saved under. */
export interface AskpassScript {
  filename: string;
  contents: string;
}
