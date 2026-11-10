import type { AgentRoleSnapshot } from "@projector-ai/core/modules/agent-role/index.ts";
import type { ChatState } from "./chat-state.ts";

/**
 * Captures a role on a chat. `force` is for a saved history: it replaces the copy the tab passed,
 * while a chat that already has a snapshot keeps it when the component mounts again.
 */
export function applyRoleSnapshot(
  state: ChatState,
  role: AgentRoleSnapshot | undefined,
  force = false,
): void {
  if (!role || (state.roleSnapshot && !force)) return;
  state.roleSnapshot = role;
  state.selection = { ...state.selection, ...role.selection };
  if (role.permissionMode) {
    state.permissionMode = role.permissionMode;
    state.selection["permission-mode"] = role.permissionMode;
  }
}
