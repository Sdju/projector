import { accessAllowed } from "../access/index.ts";
import { findProject } from "../projects/index.ts";
import { listTerminalSessions } from "../terminal/index.ts";
import { terminalControl } from "./control.ts";

/** App-owned forwarding functions let existing sockets use a newly activated runtime. */
export interface TerminalControlHandlers {
  control: typeof terminalControl;
  sessions: typeof listTerminalSessions;
  allowed: typeof accessAllowed;
  project: typeof findProject;
}

export const defaultTerminalControlHandlers: TerminalControlHandlers = {
  control: terminalControl,
  sessions: listTerminalSessions,
  allowed: accessAllowed,
  project: findProject,
};
