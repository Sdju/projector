export type LaunchMode = "server" | "window";

export type ProcessStatus = "idle" | "starting" | "running" | "stopping" | "error";

export interface ProjectCommand {
  id: string;
  name: string;
  cmd: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  url: string;
  icon: string;
  mode: LaunchMode;
  defaultCommandId: string;
  commands: ProjectCommand[];
  createdAt: string;
}

export interface ProcessSnapshot {
  projectId: string;
  commandId: string | null;
  commandName: string | null;
  status: ProcessStatus;
  pid: number | null;
  url: string | null;
  startedAt: string | null;
  exitCode: number | null;
}

export interface InspectResult {
  name: string;
  path: string;
  url: string;
  icon: string;
  mode: LaunchMode;
  defaultCommandId: string;
  commands: ProjectCommand[];
}
