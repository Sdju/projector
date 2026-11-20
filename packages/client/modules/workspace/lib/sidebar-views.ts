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
import { inboxRemoteAttention } from "../../agent/index.ts";
import HubPanel from "../ui/HubPanel.vue";
import SearchPanel from "../ui/SearchPanel.vue";
import FilesSection from "../ui/FilesSection.vue";
import CompareTreeSection from "../ui/CompareTreeSection.vue";
import { ScopeTreeSection } from "../modules/tree/index.ts";
import { TrashPanel, trashCount } from "../modules/trash/index.ts";
import type { OpenFile, OpenFileOptions } from "../open-file.ts";
import type { useGitChangeSync } from "./git-change-sync.ts";
import type { useOpenFiles } from "./open-files.ts";

/** Sections every workspace has; profiles add their own through `profile.sidebar`. */
export const baseSidebarTypes: SidebarType[] = [
  { id: "files", title: "Файлы" },
  { id: "search", title: "Поиск", requires: "search" },
  { id: "git", title: "Git", requires: "git" },
];

/**
 * Sections of the left rail: the project ones first, the service ones (`profile.utility`: Hub,
 * trash) last. Utility sections are marked so the rail draws them in its bottom group.
 */
export const sidebarSections = (profile: WorkspaceProfile, capabilities: WorkspaceCapabilities) =>
  createSidebarRegistry(
    (capability) => capabilities[capability as keyof WorkspaceCapabilities],
    baseSidebarTypes,
    profile.sidebar,
    profile.utility?.map((type) => ({ ...type, utility: true })),
  );

/** Sections of the optional right rail (`profile.aside`: terminals, owner tools). */
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
  openPullFile(number: number, path: string, head?: string, pinned?: boolean, base?: string): void;
  command(id: string, args?: unknown): void;
  /** Awaits a command of the editor scope; plugin panels get its real result and errors. */
  executeCommand?(id: string, args?: unknown): Promise<unknown>;
  refreshWorkspace(): void;
  changed(): void;
  deleted(path: string): void;
  moved(source: string, destination: string): void;
}

/** How a section is drawn; the sidebar only mounts it and wires its button. */
export interface SidebarView {
  /** Shared icon name of the section button. */
  icon: string;
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
  hub: {
    icon: "network",
    component: HubPanel,
    props: () => ({}),
    badge: () => inboxRemoteAttention(),
    refreshGutter: true,
    refresh: (_, panel) => panel?.refresh?.(),
  },
  files: {
    icon: "files",
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
    icon: "search",
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
    icon: "search",
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
    icon: "devicon:git",
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
  // Service section from `workspaceUtility`: it is drawn in the bottom group of the rail.
  trash: {
    icon: "trash-2",
    component: TrashPanel,
    props: (host, selected) => ({
      projectId: host.projectId,
      revision: host.revision,
      active: selected,
      onChanged: () => host.changed(),
    }),
    badge: (host) => trashCount(host.projectId),
    refreshGutter: true,
    refresh: (_, panel) => panel?.refresh?.(),
  },
  tree: {
    icon: "files",
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
    icon: "files",
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
    icon: "circle-dot",
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
    icon: "git-pull-request",
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
    icon: "git-merge",
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
    icon: "files",
    component: PullRequestFilesSection,
    props: (host, _selected, type) => {
      const number = Number(type?.params?.number);
      const head = typeof type?.params?.head === "string" ? type.params.head : "";
      return {
        projectId: host.projectId,
        number,
        head,
        snapshot: type?.params?.snapshot as PullRequestChanges | undefined,
        onOpen: (path: string, pinned?: boolean, nextHead?: string, base?: string) =>
          host.openPullFile(number, path, nextHead || head, pinned, base),
      };
    },
    refresh: (_, panel) => panel?.refresh?.(),
  },
  pipelines: {
    icon: "workflow",
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
    icon: "tag",
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
    icon: "messages-square",
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
    icon: "container",
    component: DockerSidebar,
    props: () => ({}),
    refreshGutter: true,
    refresh: (host, panel) => panel?.refresh?.() ?? host.command("ide.docker.refresh"),
  },
};
