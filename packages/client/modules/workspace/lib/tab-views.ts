import { inject, onBeforeUnmount, provide, type Component, type InjectionKey } from "vue";
import {
  createTabRegistry,
  type SidebarType,
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
import { AgentChat, AgentJobTab, AgentTaskTab } from "../../agent/index.ts";
import { clientAgents } from "../../agents-integration/catalog/index.ts";
import { BrowserPanel } from "../../browser/index.ts";
import {
  CommitOverview,
  DiscussionView,
  IssueView,
  PullRequestView,
} from "../modules/viewers/index.ts";

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

/** A chat tab of one external agent: its own conversation, history and approvals. */
const agentChat = (backend: string): TabView => ({
  component: AgentChat,
  keepAlive: true,
  props: (tab, host) => ({
    projectId: host.projectId,
    backend,
    chatId: tab.params?.chatId,
  }),
});

/** What a view may ask of the workspace that shows it. */
export interface TabHost {
  projectId: string;
  openFile(path: string): void;
  openTab(id: string, params?: TabParams, options?: { preview?: boolean }): void;
  openCommitDiff(hash: string, path: string): void;
  openCommitTree(hash: string): void;
  /** Opens the changed files of two snapshots in a sidebar section. */
  openCompareTree(from: string, to: string): void;
  /** Opens a changed file of a merge request as a read-only base → head tab. */
  openPullFile(number: number, path: string, head?: string, pinned?: boolean): void;
  /** Adds a temporary sidebar section (a merge request tree, a pipeline panel). */
  openSection(type: SidebarType): void;
  /** Runs an editor command of this workspace (a button of a view is a command too). */
  run(command: string, args?: unknown): void;
}

/** Base views of a workspace; agent chats come from the catalog registered before mounting. */
export function baseTabViews(): TabViews {
  return {
    keybindings: { component: KeybindingsEditor, ownKeys: true, keepAlive: true },
    network: { component: LanInfoPanel, ownKeys: true, keepAlive: true },
    docker: { component: DockerPanel, keepAlive: true },
    browser: {
      component: BrowserPanel,
      keepAlive: true,
      ownKeys: true,
      props: (tab, host) => ({
        projectId: host.projectId,
        url: tab.params?.url,
        onNavigate: (url: string, title: string) => {
          tab.params = { ...tab.params, url, title };
          if (title) tab.path = title;
        },
      }),
    },
    agent: {
      component: AgentChat,
      keepAlive: true,
      props: (tab, host) => ({ projectId: host.projectId, chatId: tab.params?.chatId }),
    },
    "agent-task": {
      component: AgentTaskTab,
      keepAlive: true,
      props: (tab, host) => ({
        projectId: host.projectId,
        chat: tab.params?.chat,
        task: tab.params?.task,
      }),
    },
    "agent-job": {
      component: AgentJobTab,
      keepAlive: true,
      props: (tab, host) => ({
        projectId: host.projectId,
        job: tab.params?.job,
        onOpenFile: host.openFile,
        onTitle: (title: string) => {
          tab.path = title;
        },
      }),
    },
    ...Object.fromEntries(
      clientAgents()
        .filter((agent) => !agent.builtin)
        .map((agent) => [agent.program, agentChat(agent.backend)]),
    ),
    issue: {
      component: IssueView,
      keepAlive: true,
      props: (tab, host) => ({
        projectId: host.projectId,
        number: tab.params?.number,
        onOpen: host.openFile,
      }),
    },
    pull: {
      component: PullRequestView,
      keepAlive: true,
      props: (tab, host) => ({
        projectId: host.projectId,
        number: tab.params?.number,
        onOpen: host.openFile,
        onOpenSection: host.openSection,
        onOpenPullFile: host.openPullFile,
        onOpenJob: (job: { id: number; title: string }) =>
          host.openTab("job", job, { preview: false }),
        onOpenPipeline: (pipeline: { id: number; title?: string }) =>
          host.openTab("pipeline", pipeline, { preview: false }),
      }),
    },
    discussion: {
      component: DiscussionView,
      keepAlive: true,
      props: (tab, host) => ({
        projectId: host.projectId,
        number: tab.params?.number,
        onOpen: host.openFile,
      }),
    },
    commit: {
      component: CommitOverview,
      keepAlive: true,
      props: (tab, host) => ({
        projectId: host.projectId,
        hash: tab.params?.hash,
        onOpenCommit: (hash: string) => host.openTab("commit", { hash }),
        onOpenDiff: host.openCommitDiff,
        onOpenTree: host.openCommitTree,
        onOpenCompare: host.openCompareTree,
        onSubject: (text: string) => (tab.content = text),
      }),
    },
  };
}

interface WorkspaceTabs {
  types: TabRegistry;
  views: TabViews;
}
const workspaceTabsKey: InjectionKey<WorkspaceTabs> = Symbol.for("projector.workspace-tabs");
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
  provide(workspaceTabsKey, { types, views: { ...baseTabViews(), ...views } });
  const detach = Object.entries(behaviors).map(([id, behavior]) => types.behave(id, behavior));
  onBeforeUnmount(() => detach.forEach((fn) => fn()));
  return types;
}
export function useWorkspaceTabs() {
  const tabs = inject(workspaceTabsKey);
  if (!tabs) throw new Error("Workspace tabs are not provided");
  return tabs;
}

const tabHostKey: InjectionKey<TabHost> = Symbol.for("projector.tab-host");
export const provideTabHost = (host: TabHost) => provide(tabHostKey, host);
export function useTabHost() {
  const host = inject(tabHostKey);
  if (!host) throw new Error("Tab host is not provided");
  return host;
}
