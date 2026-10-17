import { createAcpBackend } from "../acp/index.ts";
import { createOpencodeDialect } from "./dialect.ts";

/** OpenCode through its own ACP mode (`opencode acp`). */
export const opencodeProgram = {
  id: "opencode",
  label: "OpenCode",
  command: "opencode",
  args: ["acp"],
  dialect: createOpencodeDialect,
};

export const opencodeBackend = createAcpBackend(opencodeProgram);
