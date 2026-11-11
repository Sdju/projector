import { createAcpBackend } from "../acp/index.ts";
import type { AgentBackend } from "../../agent/index.ts";
import { createKimiDialect } from "./dialect.ts";
import { kimiUsageLog } from "./usage-log.ts";

/** Kimi Code CLI through its ACP mode (`kimi acp`). */
export const kimiProgram = {
  id: "kimi",
  label: "Kimi",
  command: "kimi",
  args: ["acp"],
  dialect: createKimiDialect,
};

export const kimiBackend: AgentBackend = {
  ...createAcpBackend(kimiProgram),
  usageLog: kimiUsageLog,
};
export { kimiUsageLog };
