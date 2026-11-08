export { default as AgentRoleSettings } from "./ui/AgentRoleSettings.vue";
export { default as AgentProjectRoles } from "./ui/AgentProjectRoles.vue";
export {
  applyAgentRoles,
  loadAgentRoles,
  loadChatRoles,
  roleControls,
  useAgentRoleSettings,
} from "./model/roles.ts";
export { useProjectRoleSettings } from "./model/project-roles.ts";
export {
  roleResources,
  type RoleMcpServer,
  type RoleResources,
  type RoleSkill,
} from "./model/resources.ts";
export type { AgentRoleSettings as AgentRoleSettingsData } from "./api/roles.ts";
