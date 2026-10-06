import type { Component } from "vue";
import {
  createSidebarRegistry,
  type SidebarType,
  type WorkspaceCapabilities,
  type WorkspaceProfile,
} from "../../workspace-api/index.ts";
import type { GitBranchesState, GitHistoryState, GitOverviewState } from "../modules/git/index.ts";
import { GitPanel } from "../modules/git/index.ts";
import { IssuesPanel } from "../modules/issues/index.ts";
import { PullsPanel } from "../modules/pulls/index.ts";
import { DockerSidebar } from "../../docker/index.ts";
import SearchPanel from "../ui/SearchPanel.vue";
import FilesSection from "../ui/FilesSection.vue";
import type { OpenFile, OpenFileOptions } from "../open-file.ts";
import type { useGitChangeSync } from "./git-change-sync.ts";
import type { useOpenFiles } from "./open-files.ts";
import IconFiles from "~icons/lucide/files";
import IconSearch from "~icons/lucide/search";
import IconGit from "~icons/devicon/git";
import IconDocker from "~icons/lucide/container";
import IconIssues from "~icons/lucide/circle-dot";
import IconPulls from "~icons/lucide/git-pull-request";

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
  command(id: string): void;
  refreshWorkspace(): void;
  changed(): void;
  deleted(path: string): void;
  moved(source: string, destination: string): void;
}

/** How a section is drawn; the sidebar only mounts it and wires its button. */
export interface SidebarView {
  icon: Component;
  component: Component;
  /** Props and listeners of the panel. */
  props(host: SidebarHost, selected: boolean): Record<string, unknown>;
  /** Count shown next to the icon. */
  badge?(host: SidebarHost): number;
  /** Runs when the section becomes the selected one. */
  activate?(host: SidebarHost): void;
  /** Refresh button; the default reloads the whole workspace. */
  refresh?(host: SidebarHost, panel: { refresh?: () => unknown } | undefined): unknown;
}
export type SidebarViews = Record<string, SidebarView>;

export const baseSidebarViews: SidebarViews = {
  files: {
    icon: IconFiles,
    component: FilesSection,
    props: (host) => ({
      projectId: host.projectId,
      beforeChange: host.files.prepareEntryChange,
      selected: host.active?.path ?? "",
      revision: host.revision,
      gitChanges: host.overview.git.value.changes,
      onChanged: host.changed,
      onDeleted: host.deleted,
      onOpen: (path: string, pinned?: boolean) =>
        host.openFile(path, undefined, undefined, undefined, { preview: !pinned }),
      onMoved: host.moved,
    }),
  },
  search: {
    icon: IconSearch,
    component: SearchPanel,
    props: (host) => ({ projectId: host.projectId, onOpen: host.openFile }),
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
      onOpenCommit: host.files.openCommit,
      onOpenCommitDiff: (hash: string, path: string, pinned?: boolean) =>
        host.files.openCommitFile(hash, path, !pinned),
    }),
    badge: (host) => host.overview.git.value.changes.length,
    activate: (host) => void host.overview.load(),
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
  docker: {
    icon: IconDocker,
    component: DockerSidebar,
    props: () => ({}),
    refresh: (host) => host.command("ide.docker.refresh"),
  },
};
