import { acpSessions, createAcpBackend } from "../acp/index.ts";
import type { AgentBackend } from "../../agent/index.ts";
import { createOpencodeDialect } from "./dialect.ts";
import { withOpenCodeBranches } from "./sessions.ts";

/** OpenCode through its own ACP mode (`opencode acp`). */
export const opencodeProgram = {
  id: "opencode",
  label: "OpenCode",
  command: "opencode",
  args: ["acp"],
  dialect: createOpencodeDialect,
};

/**
 * OpenCode lists a subagent's own session next to real chats, so the list is marked with the
 * parents it keeps in its database: history shows those as branches instead of separate chats.
 */
export const opencodeBackend: AgentBackend = {
  ...createAcpBackend(opencodeProgram),
  sessions: (cwd) => acpSessions("opencode", cwd, withOpenCodeBranches),
};
