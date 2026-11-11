/**
 * Types for a trusted server-side plugin. A plugin imports this module with `import type` only;
 * the runtime helpers arrive in the `api` argument of `createAgents(api)`, so the built package
 * stays self-contained and never imports Projector internals at runtime.
 */
export type {
  AgentBackend,
  AgentCommand,
  AgentControl,
  AgentQuestion,
  AgentRunOptions,
  AgentSelection,
  AgentSessionInfo,
  AgentSessionTurn,
  McpServerInfo,
} from "../agent/index.ts";
export type {
  AcpCompaction,
  AcpDialect,
  AcpFormAdapter,
  AcpFormField,
  AcpFormOption,
  AcpProgram,
  AcpTaskPatch,
  AcpUpdate,
} from "../agents/acp/index.ts";
export type { PluginCodeApi } from "../agents/plugin/index.ts";
export type {
  AgentUsage,
  AgentUsageWindowDefinition,
} from "@ai-projector/core/modules/usage-analytics/index.ts";
