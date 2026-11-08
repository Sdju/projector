export { default as AgentRoleSettings } from "./ui/AgentRoleSettings.vue";
export {
  applyAgentRoles,
  loadAgentRoles,
  roleControls,
  useAgentRoleCatalog,
  useAgentRoleSettings,
} from "./model/roles.ts";
export type { AgentRoleSettings as AgentRoleSettingsData } from "./api/roles.ts";
