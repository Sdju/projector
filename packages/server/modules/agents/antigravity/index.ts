import { createAcpBackend, type AcpProgram } from "../acp/index.ts";
import type { AgentBackend } from "../../agent/index.ts";
import { antigravityShellCommand, createAntigravityDialect } from "./dialect.ts";
import { handleAntigravityPermission } from "./permission.ts";
import { classifyAntigravityTurnFailure, watchAntigravityPromptOutcome } from "./turn-outcome.ts";
import { antigravityUsageLog, readAntigravityUsageFile } from "./usage-log.ts";
import { antigravityRateModel } from "./usage-proto.ts";

/**
 * Google Antigravity CLI through its official ACP mode (`agy acp`). Runs strictly as a thin
 * interactive editor client: Projector does not inject system prompts, feature/role prefixes, or
 * replayed chat history (`AGENTS.md` and `.gemini/skills` stay natively owned by `agy`).
 */
export const antigravityProgram: AcpProgram = {
  id: "antigravity",
  label: "Antigravity",
  command: "agy",
  args: ["acp"],
  terminal: { program: "agy", executable: "agy", title: "Antigravity" },
  dialect: createAntigravityDialect,
  shellCommand: antigravityShellCommand,
  permissionRequest: handleAntigravityPermission,
  // Ambient API keys switch `agy` off Google OAuth so subscription models return 401.
  scrubEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  // Keep `/logout` out of chat menus so a turn cannot sign out the host CLI session.
  withheldCommands: ["logout"],
  // Thin-client compliance for consumer OAuth: never inject custom system prompts or replayed history.
  nativePromptOnly: true,
  watchPromptOutcome: (sessionId) => watchAntigravityPromptOutcome(sessionId),
  authHint: "Требуется вход в Antigravity: выполните agy или agy acp --login в терминале",
};

export const antigravityBackend: AgentBackend = {
  ...createAcpBackend(antigravityProgram),
  usageLog: antigravityUsageLog,
};

export {
  antigravityRateModel,
  antigravityShellCommand,
  antigravityUsageLog,
  classifyAntigravityTurnFailure,
  createAntigravityDialect,
  handleAntigravityPermission,
  readAntigravityUsageFile,
  watchAntigravityPromptOutcome,
};
