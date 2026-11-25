import { createAcpBackend } from "../acp/index.ts";
import type { AgentBackend } from "../../agent/index.ts";
import { createKimiDialect } from "./dialect.ts";
import { prepareKimiFollowUp } from "./follow-up.ts";
import { kimiUsageLog } from "./usage-log.ts";

/**
 * Kimi Code CLI through its ACP mode (`kimi acp`).
 *
 * Do not trust `usage_update.used` as the current context size. Kimi sends its own
 * `getContext().tokenCount`, and the `measured+estimated` counter can drift past the window:
 * one session reported 2,922,722 tokens for a 1,048,576 window while the last provider request
 * was 393,506 prompt tokens, and Kimi's own auto-compaction was blocked by the active turn.
 * `size` stays correct. Projector shows the ACP value as is, so `used > size` is not a real
 * overflow. A measured fallback would be the latest turn-scoped `usage.record` from the session
 * `wire.jsonl` (`inputOther + inputCacheRead + inputCacheCreation`, already parsed by
 * `kimiUsageLog`), but it describes the last request, not the context after a tool result.
 */
export const kimiProgram = {
  id: "kimi",
  label: "Kimi",
  command: "kimi",
  args: ["acp"],
  dialect: createKimiDialect,
  prepareFollowUp: prepareKimiFollowUp,
  exclusiveSession: true,
  finishAfterBackground: true,
};

export const kimiBackend: AgentBackend = {
  ...createAcpBackend(kimiProgram),
  usageLog: kimiUsageLog,
};
export { kimiUsageLog };
export { hydrateKimiHistoryTasks } from "./history-tasks.ts";
