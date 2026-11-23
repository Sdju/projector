// Public types a trusted server-side plugin may use. They are erased at compile time, so the
// built `server.cjs` stays self-contained; runtime helpers come from `createAgents(api)`.
export type {
  AcpDialect,
  AcpProgram,
  AcpTaskPatch,
  AcpUpdate,
  AgentBackend,
  AgentCommand,
  AgentControl,
  AgentEmitter,
  AgentQuestion,
  AgentRunHandle,
  AgentRunOptions,
  AgentSelection,
  AgentSessionInfo,
  AgentSessionTurn,
  AgentUsage,
  AgentUsageWindowDefinition,
  McpServerConfig,
  McpServerInfo,
  PluginCodeApi,
  RewindResult,
  UsageCostSource,
  UsageLogEvent,
  UsageLogRead,
  UsageLogReader,
  UsageTokens,
} from "../../../packages/server/modules/plugin-api/index.ts";

export type { AgentTask, AgentTaskPatch } from "../../../packages/core/modules/agent-task/index.ts";

import type * as ClaudeAgentSdk from "@anthropic-ai/claude-agent-sdk";

/** The Agent SDK, loaded from this plugin's own `node_modules` at runtime (`api.require`). */
export type ClaudeSdk = typeof ClaudeAgentSdk;
