export type TerminalProgram = "shell" | "codex" | "claude";

export interface TerminalSession {
  id: string;
  projectId: string;
  program: TerminalProgram;
  title: string;
  pid: number;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode: number | null;
  startedAt: string;
}

export type TerminalClientMessage =
  | { type: "input"; data: string }
  | { type: "ack"; length: number }
  | { type: "resize"; cols: number; rows: number };

export type TerminalServerMessage =
  | { type: "snapshot"; session: TerminalSession; data: string }
  | { type: "output"; data: string }
  | { type: "status"; session: TerminalSession }
  | { type: "error"; message: string };
