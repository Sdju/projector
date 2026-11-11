// Public types a trusted server-side plugin may use. They are erased at compile time, so the
// built `server.cjs` stays self-contained; runtime helpers come from `createAgents(api)`.
export type {
  AcpDialect,
  AcpProgram,
  AcpTaskPatch,
  AcpUpdate,
  AgentBackend,
  AgentControl,
  AgentQuestion,
  AgentRunOptions,
  AgentSelection,
  AgentUsage,
  AgentUsageWindowDefinition,
  PluginCodeApi,
  UsageCostSource,
  UsageLogEvent,
  UsageLogRead,
  UsageLogReader,
  UsageTokens,
} from "../../../packages/server/modules/plugin-api/index.ts";
