import { inject, onBeforeUnmount, provide, type Component, type InjectionKey } from "vue";
import {
  createTabRegistry,
  type TabBehavior,
  type TabRegistry,
  type WorkspaceProfile,
} from "../../workspace-api/index.ts";
import { baseTabTypes } from "./virtual-tabs.ts";
import type { OpenFile } from "../open-file.ts";
import { KeybindingsEditor } from "../../ide/index.ts";
import { LanInfoPanel } from "../../network/index.ts";
import { DockerPanel } from "../../docker/index.ts";
import { AgentChat } from "../../agent/index.ts";
import { IssueView } from "../modules/viewers/index.ts";

/** How a tab kind is drawn; the owner of the kind supplies it, the workspace only mounts it. */
export interface TabView {
  component: Component;
  /** Props from the tab and its project; the view emits `open` with a file path. */
  props?: (tab: OpenFile, projectId: string) => Record<string, unknown>;
  /** The view holds state (a chat, an unsaved form): it stays mounted and moves between docks. */
  keepAlive?: boolean;
  /** The panel pads and scrolls its content. */
  scroll?: boolean;
}
export type TabViews = Record<string, TabView>;

export const baseTabViews: TabViews = {
  keybindings: { component: KeybindingsEditor },
  network: { component: LanInfoPanel },
  docker: { component: DockerPanel },
  agent: { component: AgentChat, keepAlive: true, props: (_, projectId) => ({ projectId }) },
  issue: {
    component: IssueView,
    props: (tab, projectId) => ({ projectId, number: tab.params?.number }),
  },
};

interface WorkspaceTabs {
  types: TabRegistry;
  views: TabViews;
}
const workspaceTabsKey: InjectionKey<WorkspaceTabs> = Symbol("workspace-tabs");
/**
 * Composes the tab kinds of a workspace: base kinds, kinds of the profile, views of the
 * embedding page and host behavior. Descendants read them through `useWorkspaceTabs`.
 */
export function useWorkspaceTabTypes(
  profile: WorkspaceProfile,
  views: TabViews = {},
  behaviors: Record<string, TabBehavior> = {},
) {
  const types = createTabRegistry(baseTabTypes, profile.tabs);
  provide(workspaceTabsKey, { types, views: { ...baseTabViews, ...views } });
  const detach = Object.entries(behaviors).map(([id, behavior]) => types.behave(id, behavior));
  onBeforeUnmount(() => detach.forEach((fn) => fn()));
  return types;
}
export function useWorkspaceTabs() {
  const tabs = inject(workspaceTabsKey);
  if (!tabs) throw new Error("Workspace tabs are not provided");
  return tabs;
}
