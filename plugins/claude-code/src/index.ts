import type { AgentBackend, ClaudeSdk, PluginCodeApi } from "./api.ts";
import { createClaudeBackend } from "./claude-code-backend.ts";
import { createClaudeUsageProvider, claudeUsageWindows } from "./usage.ts";

/**
 * Claude Code through the Anthropic Agent SDK: its own prompt, tools, login, `CLAUDE.md` and
 * settings. The plugin brings the answer, session history, file rewind, limits and the task list;
 * Projector only hosts the process and relays the chat events.
 */
export function createAgents(api: PluginCodeApi): AgentBackend[] {
  const sdk = api.require("@anthropic-ai/claude-agent-sdk") as ClaudeSdk;
  const backend = createClaudeBackend(api);
  backend.plan = { tools: ["TodoWrite"] };
  backend.usage = createClaudeUsageProvider(sdk);
  backend.usageWindows = claudeUsageWindows;
  return [backend];
}
