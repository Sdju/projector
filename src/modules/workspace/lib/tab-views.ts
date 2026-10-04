import { inject, onBeforeUnmount, provide, type Component, type InjectionKey } from "vue";
import {
  createTabRegistry,
  type TabBehavior,
  type TabParams,
  type TabRegistry,
  type WorkspaceProfile,
} from "../../workspace-api/index.ts";
import { baseTabTypes } from "./virtual-tabs.ts";
import type { OpenFile } from "../open-file.ts";
import { KeybindingsEditor } from "../../ide/index.ts";
import { LanInfoPanel } from "../../network/index.ts";
import { DockerPanel } from "../../docker/index.ts";
import { AgentChat } from "../../agent/index.ts";
import { CommitOverview, IssueView } from "../modules/viewers/index.ts";

/** How a tab kind is drawn; the owner of the kind supplies it, the workspace only mounts it. */
export interface TabView {
  component: Component;
  /** Props and event listeners (`onOpen`...) of the view, built from the tab and the host. */
  props?: (tab: OpenFile, host: TabHost) => Record<string, unknown>;
  /** The view handles keyboard itself: editor shortcuts do not fire inside it. */
  ownKeys?: boolean;
  /** The view holds state (a chat, an unsaved form): it stays mounted and moves between docks. */
  keepAlive?: boolean;
  /** The panel pads and scrolls its content. */
  scroll?: boolean;
}
export type TabViews = Record<string, TabView>;

/** What a view may ask of the workspace that shows it. */
export interface TabHost {
  projectId: string;
  openFile(path: string): void;
  openTab(id: string, params?: TabParams, options?: { preview?: boolean }): void;
  openCommitDiff(hash: string, path: string): void;
}

export const baseTabViews: TabViews = {
  keybindings: { component: KeybindingsEditor, ownKeys: true },
  network: { component: LanInfoPanel, ownKeys: true },
  docker: { component: DockerPanel },
  agent: {
    component: AgentChat,
    keepAlive: true,
    props: (_, host) => ({ projectId: host.projectId }),
  },
  issue: {
    component: IssueView,
    props: (tab, host) => ({
      projectId: host.projectId,
      number: tab.params?.number,
      onOpen: host.openFile,
    }),
  },
  commit: {
    component: CommitOverview,
    props: (tab, host) => ({
      projectId: host.projectId,
      hash: tab.params?.hash,
      onOpenCommit: (hash: string) => host.openTab("commit", { hash }),
      onOpenDiff: host.openCommitDiff,
      onSubject: (text: string) => (tab.content = text),
    }),
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

const tabHostKey: InjectionKey<TabHost> = Symbol("tab-host");
export const provideTabHost = (host: TabHost) => provide(tabHostKey, host);
export function useTabHost() {
  const host = inject(tabHostKey);
  if (!host) throw new Error("Tab host is not provided");
  return host;
}
