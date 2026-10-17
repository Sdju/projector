export type LaunchMode = "server" | "window";

export type ProcessStatus = "idle" | "starting" | "running" | "stopping" | "error";

export interface ProjectCommand {
  id: string;
  name: string;
  cmd: string;
  /** Folder inside the project the command runs in; absent means the project root. */
  cwd?: string;
  /** Address of this scenario's app; absent means the project's address. */
  url?: string;
  /** Launch mode of this scenario; absent means the project's mode. */
  mode?: LaunchMode;
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
  environment?: import("../environment/index.ts").DockerEnvironment;
  runtime?: ProcessSnapshot;
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

export type ProjectDraft = Pick<
  Project,
  "name" | "path" | "url" | "icon" | "mode" | "defaultCommandId" | "commands"
>;
