export type TerminalProgram = "shell" | "codex" | "claude" | "opencode";

export interface TerminalActivity {
  state: "idle" | "busy" | "unknown";
  processes: { pid: number; name: string }[];
  confirmation: string;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  program: TerminalProgram;
  title: string;
  customTitle?: string;
  commandId?: string;
  pid: number;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode: number | null;
  stopRequested?: boolean;
  activity?: TerminalActivity;
  startedAt: string;
}

export type TerminalClientMessage =
  | { type: "input"; data: string; encoding?: "binary" }
  | { type: "ack"; length: number }
  | { type: "resize"; cols: number; rows: number };

export type TerminalServerMessage =
  | { type: "snapshot"; session: TerminalSession; data: string }
  | { type: "output"; data: string }
  | { type: "status"; session: TerminalSession }
  | { type: "error"; message: string };
