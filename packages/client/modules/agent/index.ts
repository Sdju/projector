export { default as AgentChat } from "./ui/AgentChat.vue";
export { roleFromParam } from "../agent-core/index.ts";
export { AgentTaskTab } from "../agent-turns/index.ts";
export { AgentJobTab } from "./modules/jobs/index.ts";
export { ActivityIsland } from "./modules/jobs/index.ts";
export { AgentInbox } from "./modules/jobs/index.ts";
export { AgentInboxBell } from "./modules/jobs/index.ts";
export { inboxAttention } from "./modules/jobs/index.ts";
export { requestChatTab, requestJobTab } from "../agent-core/index.ts";
export { projectInitPrompt } from "../agent-core/index.ts";
export { useAgent } from "../agent-core/index.ts";
export {
  useAgentModes,
  guiAgents,
  guiCommand,
  hasGui,
  builtinAgent,
  isBuiltinAgent,
  agentLabel,
} from "../agent-core/index.ts";
export type { AgentSessionMode } from "../agent-core/index.ts";
export { AgentSettings } from "./modules/settings/index.ts";
export { AgentModeSettings } from "./modules/settings/index.ts";
export { AgentIntegrationsSettings } from "./modules/settings/index.ts";
export { agentSection, agentOf } from "./model/nav.ts";
export { AgentSkillsSettings } from "./modules/settings/index.ts";
export { AgentWebSettings } from "./modules/settings/index.ts";
export { AgentMcpSettings } from "./modules/settings/index.ts";
export { AgentHooksSettings } from "./modules/settings/index.ts";
export { AgentMemorySettings } from "./modules/settings/index.ts";
export { AgentJudgeSettings } from "./modules/settings/index.ts";
export { registerAgentCommands } from "./model/agent-commands.ts";
export { attachChipsToChat, attachRangeToChat, attachTextToChat } from "./model/attach.ts";
export type { AttachChatOptions, AttachTextOptions } from "./model/attach.ts";
export { useAgentActivity } from "./modules/jobs/index.ts";
export type { AgentActivityItem } from "./modules/jobs/index.ts";
export { formatElapsed, useElapsedClock } from "../agent-core/index.ts";
