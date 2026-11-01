import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpServer } from "vite";
import type { ServerMode } from "../../core/modules/server-mode/index.ts";
import type { accessAllowed } from "../modules/access/index.ts";
import type { terminalControl } from "../modules/terminal-control/index.ts";
import type { findProject, loadProjects } from "../modules/projects/index.ts";
import type { listTerminalSessions } from "../modules/terminal/index.ts";

/** A request captures one generation; long-lived transports resolve it for each operation. */
export interface RuntimeHandlers {
  handleHttp(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void>;
  terminalControl: typeof terminalControl;
  terminalSessions: typeof listTerminalSessions;
  accessAllowed: typeof accessAllowed;
  findProject: typeof findProject;
  loadProjects: typeof loadProjects;
}

export interface RuntimeModule {
  getRuntimeHandlers(): RuntimeHandlers;
  bindRuntime(
    server: HttpServer | null,
    mode: ServerMode,
    handlers?: () => RuntimeHandlers,
  ): () => void;
}
