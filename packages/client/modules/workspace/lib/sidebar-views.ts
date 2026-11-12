import type { Component } from "vue";
import {
  ciTabParams,
  createSidebarRegistry,
  workspaceCapabilities,
  type SidebarType,
  type WorkspaceCapabilities,
  type WorkspaceProfile,
} from "../../workspace-api/index.ts";
import type { GitBranchesState, GitHistoryState, GitOverviewState } from "../modules/git/index.ts";
import {
  fileChangeDecorations,
  fileScopeKey,
  gitChangesToFileChanges,
  type FileScope,
  type PullRequestChanges,
} from "@ai-projector/core/modules/workspace/index.ts";
import { GitPanel } from "../modules/git/index.ts";
import {
  DiscussionsPanel,
  IssuesPanel,
  PullsPanel,
  PullRequestFilesSection,
} from "../modules/issues/index.ts";
import { PipelinesPanel } from "../modules/pipelines/index.ts";
import { ReleasesPanel } from "../modules/releases/index.ts";
import { DockerSidebar } from "../../docker/index.ts";
import { AgentInbox, inboxAttention } from "../../agent/index.ts";
import SearchPanel from "../ui/SearchPanel.vue";
import FilesSection from "../ui/FilesSection.vue";
import CompareTreeSection from "../ui/CompareTreeSection.vue";
import { ScopeTreeSection } from "../modules/tree/index.ts";
import type { OpenFile, OpenFileOptions } from "../open-file.ts";
import type { useGitChangeSync } from "./git-change-sync.ts";
import type { useOpenFiles } from "./open-files.ts";
import IconFiles from "~icons/lucide/files";
import IconSearch from "~icons/lucide/search";
import IconGit from "~icons/devicon/git";
import IconDocker from "~icons/lucide/container";
import IconBell from "~icons/lucide/bell";
import IconIssues from "~icons/lucide/circle-dot";
import IconPulls from "~icons/lucide/git-pull-request";
import IconMerge from "~icons/lucide/git-merge";
import IconDiscussions from "~icons/lucide/messages-square";
import IconPipelines from "~icons/lucide/workflow";
import IconReleases from "~icons/lucide/tag";

/** Sections every workspace has; profiles add their own through `profile.sidebar`. */
export const baseSidebarTypes: SidebarType[] = [
  { id: "files", title: "Файлы" },
  { id: "search", title: "Поиск", requires: "search" },
  { id: "git", title: "Git", requires: "git" },
];

export const sidebarSections = (profile: WorkspaceProfile, capabilities: WorkspaceCapabilities) =>
  createSidebarRegistry(
    (capability) => capabilities[capability as keyof WorkspaceCapabilities],
    baseSidebarTypes,
    profile.sidebar,
  );

/**
 * Sections of the right rail. The base workspace has none: the owner adds them through
 * `profile.aside` and supplies their views with `asideViews`.
 */
export const asideSections = (profile: WorkspaceProfile, capabilities: WorkspaceCapabilities) =>
  createSidebarRegistry(
    (capability) => capabilities[capability as keyof WorkspaceCapabilities],
    profile.aside,
  );

/** What a section may ask of the workspace that shows it. */
export interface SidebarHost {
  readonly projectId: string;
  readonly active: OpenFile | undefined;
  readonly revision: number;
  readonly overview: GitOverviewState;
  readonly history: GitHistoryState;
  readonly branches: GitBranchesState;
  readonly files: ReturnType<typeof useOpenFiles>;
  readonly gitSync: ReturnType<typeof useGitChangeSync>;
  openFile(
    path: string,
    line?: number,
    column?: number,
    staged?: boolean,
    options?: OpenFileOptions,
  ): unknown;
  openTab(id: string, params?: Record<string, unknown>, options?: { preview?: boolean }): void;
  openCommitTree(hash: string): void;
  /** Opens a read-only search panel for a committed snapshot. */
  openSearch(scope: FileScope): void;
  openPullFile(number: number, path: string, head?: string, pinned?: boolean): void;
  command(id: string, args?: unknown): void;
  refreshWorkspace(): void;
  changed(): void;
  deleted(path: string): void;
  moved(source: string, destination: string): void;
}

/** How a section is drawn; the sidebar only mounts it and wires its button. */
export interface SidebarView {
  icon: Component;
  /** Root owns its fill/scroll recipe; the host keeps panels mounted with v-show. */
  component: Component;
  /** Props and listeners of the panel. */
  props(host: SidebarHost, selected: boolean, type?: SidebarType): Record<string, unknown>;
  /** Count shown next to the icon. */
  badge?(host: SidebarHost): number;
  /** Runs when the section becomes the selected one. */
  activate?(host: SidebarHost): void;
  /** Refresh button; the default reloads the whole workspace. */
  refresh?(host: SidebarHost, panel: { refresh?: () => unknown } | undefined): unknown;
  /**
   * The panel draws the refresh button in its toolbar. Files and GitHub/GitLab lists leave
   * this unset — the host overlay sits in an empty corner.
   */
  refreshGutter?: boolean;
}
export type SidebarViews = Record<string, SidebarView>;

export const baseSidebarViews: SidebarViews = {
  inbox: {
    icon: IconBell,
    component: AgentInbox,
    props: () => ({}),
    badge: () => inboxAttention(),
    refreshGutter: true,
    refresh: (_, panel) => panel?.refresh?.(),
  },
  files: {
    icon: IconFiles,
    component: FilesSection,
    props: (host) => ({
      projectId: host.projectId,
      beforeChange: host.files.prepareEntryChange,
      selected: host.active?.path ?? "",
      revision: host.revision,
      decorations: fileChangeDecorations(gitChangesToFileChanges(host.overview.git.value.changes)),
      onChanged: host.changed,
      onDeleted: host.deleted,
      onOpen: (path: string, pinned?: boolean) =>
        host.openFile(path, undefined, undefined, undefined, { preview: !pinned }),
      onInfo: (entry: { path: string; directory: boolean }) =>
        host.openTab(
          "entry-info",
          { path: entry.path, directory: entry.directory },
          { preview: false },
        ),
      onMoved: host.moved,
    }),
  },
  search: {
    icon: IconSearch,
    component: SearchPanel,
    props: (host) => ({
      projectId: host.projectId,
      onOpen: host.openFile,
      onReveal: (path: string) => host.command("ide.workbench.tree.reveal", { path }),
    }),
    refreshGutter: true,
    refresh: (_, panel) => panel?.refresh?.(),
  },
  "search-scope": {
    icon: IconSearch,
    component: SearchPanel,
    props: (host, _selected, type) => {
      const scope = type?.params?.scope as FileScope | undefined;
      if (!scope) throw new Error("У поиска нет источника");
      return {
        projectId: host.projectId,
        scope,
        onOpen: (path: string, line: number, column: number) =>
          host.openFile(path, line, column, undefined, { scope, preview: false }),
      };
    },
    refreshGutter: true,
    refresh: (_, panel) => panel?.refresh?.(),
  },
  git: {
    icon: IconGit,
    component: GitPanel,
    props: (host) => ({
      projectId: host.projectId,
      overview: host.overview,
      history: host.history,
      branches: host.branches,
      selected: host.active ? { path: host.active.path, staged: host.active.staged } : undefined,
      prepare: host.gitSync.prepare,
      invalidate: host.files.invalidate,
      applied: host.gitSync.applied,
      onOpen: (path: string, staged?: boolean, pinned?: boolean) =>
        host.openFile(path, undefined, undefined, staged, { preview: !pinned }),
      reveal: (path: string) => host.command("ide.workbench.tree.reveal", { path }),
      onOpenCommit: host.files.openCommit,
      onOpenCommitTree: host.openCommitTree,
      onOpenCommitDiff: (hash: string, path: string, pinned?: boolean) =>
        host.files.openCommitFile(hash, path, !pinned),
    }),
    badge: (host) => host.overview.git.value.changes.length,
    activate: (host) => void host.overview.load(),
    refreshGutter: true,
    refresh: (_, panel) => panel?.refresh?.(),
  },
  tree: {
    icon: IconFiles,
    component: ScopeTreeSection,
    props: (host, _selected, type) => {
      const scope = type?.params?.scope as FileScope | undefined;
      if (!scope) throw new Error("У раздела дерева нет источника");
      return {
        projectId: host.projectId,
        scope,
        revision: host.revision,
        selected:
          host.active?.scope && fileScopeKey(host.active.scope) === fileScopeKey(scope)
            ? host.active.path
            : "",
        onSearch: workspaceCapabilities(host.projectId).search ? host.openSearch : undefined,
        onOpen: (path: string, pinned?: boolean) =>
          host.openFile(path, undefined, undefined, undefined, {
            scope,
            preview: !pinned,
          }),
      };
    },
  },
  changes: {
    icon: IconFiles,
    component: CompareTreeSection,
    props: (host, _selected, type) => {
      const scope = type?.params?.scope as FileScope | undefined;
      if (!scope) throw new Error("У раздела сравнения нет источника");
      return {
        projectId: host.projectId,
        scope,
        revision: host.revision,
        selected:
          host.active?.scope && fileScopeKey(host.active.scope) === fileScopeKey(scope)
            ? host.active.path
            : "",
        onOpen: (path: string, pinned?: boolean, originalPath?: string) =>
          host.openFile(path, undefined, undefined, undefined, {
            scope,
            originalPath,
            preview: !pinned,
          }),
      };
    },
    refresh: (_, panel) => panel?.refresh?.(),
  },
  issues: {
    icon: IconIssues,
    component: IssuesPanel,
    props: (host, selected) => ({
      projectId: host.projectId,
      active: selected,
      onOpen: (issue: { number: number; title: string }, pinned?: boolean) =>
        host.openTab("issue", issue, { preview: !pinned }),
    }),
    refresh: (_, panel) => panel?.refresh?.(),
  },
  pulls: {
    icon: IconPulls,
    component: PullsPanel,
    props: (host, selected) => ({
      projectId: host.projectId,
      active: selected,
      onOpen: (pull: { number: number; title: string }, pinned?: boolean) =>
        host.openTab("pull", pull, { preview: !pinned }),
    }),
    refresh: (_, panel) => panel?.refresh?.(),
  },
  "merge-requests": {
    icon: IconMerge,
    component: PullsPanel,
    props: (host, selected) => ({
      projectId: host.projectId,
      active: selected,
      onOpen: (pull: { number: number; title: string }, pinned?: boolean) =>
        host.openTab("pull", pull, { preview: !pinned }),
      title: "Merge requests",
      noun: "merge requests",
      singular: "merge request",
      kind: "mergeRequests",
      host: "GitLab",
      action: "pulls",
    }),
    refresh: (_, panel) => panel?.refresh?.(),
  },
  "merge-request-files": {
    icon: IconFiles,
    component: PullRequestFilesSection,
    props: (host, _selected, type) => {
      const number = Number(type?.params?.number);
      const head = typeof type?.params?.head === "string" ? type.params.head : "";
      return {
        projectId: host.projectId,
        number,
        head,
        snapshot: type?.params?.snapshot as PullRequestChanges | undefined,
        onOpen: (path: string, pinned?: boolean, nextHead?: string) =>
          host.openPullFile(number, path, nextHead || head, pinned),
      };
    },
    refresh: (_, panel) => panel?.refresh?.(),
  },
  pipelines: {
    icon: IconPipelines,
    component: PipelinesPanel,
    props: (host, selected) => ({
      projectId: host.projectId,
      active: selected,
      onOpen: (pipeline: { id: number; number?: number; title?: string }, pinned?: boolean) =>
        host.openTab("pipeline", ciTabParams(pipeline), { preview: !pinned }),
    }),
    refresh: (_, panel) => panel?.refresh?.(),
  },
  releases: {
    icon: IconReleases,
    component: ReleasesPanel,
    props: (host, selected) => ({
      projectId: host.projectId,
      active: selected,
      onOpen: (release: { tag: string; title?: string }, pinned?: boolean) =>
        host.openTab("release", release, { preview: !pinned }),
    }),
    refresh: (_, panel) => panel?.refresh?.(),
  },
  discussions: {
    icon: IconDiscussions,
    component: DiscussionsPanel,
    props: (host, selected) => ({
      projectId: host.projectId,
      active: selected,
      onOpen: (discussion: { number: number; title: string }, pinned?: boolean) =>
        host.openTab("discussion", discussion, { preview: !pinned }),
    }),
    refresh: (_, panel) => panel?.refresh?.(),
  },
  docker: {
    icon: IconDocker,
    component: DockerSidebar,
    props: () => ({}),
    refreshGutter: true,
    refresh: (host, panel) => panel?.refresh?.() ?? host.command("ide.docker.refresh"),
  },
};
