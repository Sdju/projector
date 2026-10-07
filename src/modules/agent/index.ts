export { default as AgentChat } from "./ui/AgentChat.vue";
export { projectInitPrompt } from "./lib/init-prompt.ts";
export { useAgent } from "./model/session.ts";
export { useAgentModes, guiPrograms } from "./model/modes.ts";
export type { AgentSessionMode } from "./model/modes.ts";
export { default as AgentModeSettings } from "./ui/AgentModeSettings.vue";
