export { default as AgentChat } from "./ui/AgentChat.vue";
export { default as AgentTaskTab } from "./ui/AgentTaskTab.vue";
export { default as AgentJobTab } from "./ui/AgentJobTab.vue";
export { default as ActivityIsland } from "./ui/ActivityIsland.vue";
export { requestChatTab, requestJobTab } from "./model/job-open.ts";
export { projectInitPrompt } from "./lib/init-prompt.ts";
export { useAgent } from "./model/session.ts";
export {
  useAgentModes,
  guiAgents,
  guiCommand,
  hasGui,
  builtinAgent,
  isBuiltinAgent,
  agentLabel,
} from "./model/modes.ts";
export type { AgentSessionMode } from "./model/modes.ts";
export { default as AgentSettings } from "./ui/AgentSettings.vue";
export { default as AgentModeSettings } from "./ui/AgentModeSettings.vue";
export { default as AgentIntegrationsSettings } from "./ui/AgentIntegrationsSettings.vue";
export { agentSection, agentOf } from "./model/nav.ts";
export { default as AgentSkillsSettings } from "./ui/AgentSkillsSettings.vue";
export { default as AgentWebSettings } from "./ui/AgentWebSettings.vue";
export { default as AgentMcpSettings } from "./ui/AgentMcpSettings.vue";
export { default as AgentHooksSettings } from "./ui/AgentHooksSettings.vue";
export { default as AgentMemorySettings } from "./ui/AgentMemorySettings.vue";
export { default as AgentJudgeSettings } from "./ui/AgentJudgeSettings.vue";
export { registerAgentCommands } from "./model/agent-commands.ts";
export { useAgentActivity } from "./model/activity.ts";
export type { AgentActivityItem } from "./model/activity.ts";
export { formatElapsed, useElapsedClock } from "./lib/elapsed.ts";
