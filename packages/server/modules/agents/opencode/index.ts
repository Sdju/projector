import { acpSessions, createAcpBackend } from "../acp/index.ts";
import type { AgentBackend } from "../../agent/index.ts";
import { createOpencodeDialect } from "./dialect.ts";
import { withOpenCodeBranches } from "./sessions.ts";
import { opencodeUsageLog } from "./usage-log.ts";

/**
 * OpenCode through its own ACP mode (`opencode acp`). Version 2 (`@opencode/cli`) ships the same
 * executable as `opencode2`, so an older v1 may stay on PATH; the newer binary is preferred when
 * installed. It advertises `session/delete` and drops probe sessions on close, so history can
 * remove past sessions instead of leaving the placeholders behind.
 */
export const opencodeProgram = {
  id: "opencode",
  label: "OpenCode",
  command: "opencode",
  args: ["acp"],
  binary: "opencode2",
  binaryArgs: ["acp"],
  dialect: createOpencodeDialect,
  // ACP v2 compaction updates carry the summary; older builds fall back to `_meta` markers.
  clientCapabilities: { session: { compaction: {} } },
};

/**
 * OpenCode lists a subagent's own session next to real chats, so the list is marked with the
 * parents it keeps in its database: history shows those as branches instead of separate chats.
 */
export const opencodeBackend: AgentBackend = {
  ...createAcpBackend(opencodeProgram),
  sessions: (cwd) => acpSessions("opencode", cwd, withOpenCodeBranches),
  usageLog: opencodeUsageLog,
};
export { opencodeUsageLog };
