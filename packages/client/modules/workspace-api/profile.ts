import type { FileScope } from "@projector/core/modules/workspace/index.ts";
import type { SidebarType } from "./sidebar.ts";
import type { TabType } from "./tabs.ts";

export type WorkspaceCapability =
  | "write"
  | "git"
  | "search"
  | "issues"
  | "pulls"
  | "discussions"
  | "pipelines"
  | "releases"
  | "terminals"
  | "docker"
  | "agent"
  | "settings"
  | "persist"
  | "externalFiles"
  | "snapshots"
  | "compare"
  | "reveal";
export type WorkspaceCapabilities = Record<WorkspaceCapability, boolean>;

export type WorkspaceParams = Record<string, string>;
export interface ReadProvider {
  read(action: string, params: WorkspaceParams, signal?: AbortSignal): Promise<unknown>;
}
export type FileWrite = "file" | "move" | "entry" | "import";
export interface WorkspaceWatchPatch {
  paths?: string[];
  directories?: string[];
}
export interface WorkspaceWatchHandlers {
  file?(path: string): void;
  directory?(path: string): void;
  reconnect?(): void;
  error?(message: string): void;
}
export interface WorkspaceWatch {
  update(patch: WorkspaceWatchPatch, keepalive?: boolean): Promise<boolean>;
  subscribe(handlers: WorkspaceWatchHandlers): () => void;
}
export interface FilesProvider extends ReadProvider {
  assetUrl(path: string, external?: boolean): string;
  /** Address of an asset inside a snapshot; only providers that can serve it implement this. */
  scopeAssetUrl?(scope: FileScope, path: string): string;
  /** Address that serves the file as part of a site (relative links resolve); absent when it cannot. */
  siteUrl?(path: string): string;
  /** Reads a historical tree and its files read-only (`tree`/`file` with `rev`). */
  snapshots?: boolean;
  /** Reads changed paths and two file sides between snapshots (`changes`/`compare-file`). */
  compare?: boolean;
  /** Present only when the files can change. */
  write?(endpoint: FileWrite, body: unknown, failure?: string): Promise<unknown>;
  /** Shows an entry in the OS file manager; present only where the files live on this machine. */
  reveal?(path: string): Promise<unknown>;
  /** Loads one browser file (or an empty folder when `body` is absent) into the project; present only where uploads are possible. */
  upload?(
    directory: string,
    path: string,
    body: Blob | undefined,
    signal?: AbortSignal,
  ): Promise<{ destination: string }>;
  /** Re-reads a mutable snapshot (a remote ref moved). */
  refresh?(): Promise<void>;
  /** Optional live change stream; transport and project filtering belong to the adapter. */
  watch?: WorkspaceWatch;
}
export type GitWrite = "git" | "branch";
export interface GitProvider extends ReadProvider {
  /** False when history can only follow the opened ref. */
  allBranches?: boolean;
  write?(endpoint: GitWrite, body: unknown, failure?: string): Promise<unknown>;
}

/** Features the workspace cannot derive from its data providers. */
export type WorkspaceFeatures = Pick<
  WorkspaceCapabilities,
  "terminals" | "docker" | "agent" | "settings" | "persist" | "externalFiles"
>;

/**
 * Everything a feature may ask about a workspace. Features look at the profile only:
 * they never decide by project id, scheme or command name.
 */
export interface WorkspaceProfile {
  id: string;
  providers: {
    files: FilesProvider;
    git?: GitProvider;
    search?: ReadProvider;
    issues?: ReadProvider;
    pulls?: ReadProvider;
    discussions?: ReadProvider;
    pipelines?: ReadProvider;
    releases?: ReadProvider;
  };
  features: Readonly<WorkspaceFeatures>;
  /** Service tab kinds this workspace adds to the base set. */
  tabs?: readonly TabType[];
  /** Sidebar sections this workspace adds to the base set. */
  sidebar?: readonly SidebarType[];
  /** `full` — editor and terminals; `editor` — a single editor group. */
  layout: "full" | "editor";
}

const capabilityCache = new WeakMap<WorkspaceProfile, Readonly<WorkspaceCapabilities>>();
export function profileCapabilities(profile: WorkspaceProfile): Readonly<WorkspaceCapabilities> {
  let capabilities = capabilityCache.get(profile);
  if (!capabilities) {
    capabilities = Object.freeze({
      ...profile.features,
      write: !!profile.providers.files.write,
      git: !!profile.providers.git,
      search: !!profile.providers.search,
      issues: !!profile.providers.issues,
      pulls: !!profile.providers.pulls,
      discussions: !!profile.providers.discussions,
      pipelines: !!profile.providers.pipelines,
      releases: !!profile.providers.releases,
      snapshots: !!profile.providers.files.snapshots,
      compare: !!profile.providers.files.compare,
      reveal: !!profile.providers.files.reveal,
    });
    capabilityCache.set(profile, capabilities);
  }
  return capabilities;
}

/** Which provider serves a read action; the table is the only place that knows the split. */
const READ_DOMAIN: Record<
  string,
  "files" | "git" | "search" | "issues" | "pulls" | "discussions" | "pipelines" | "releases"
> = {
  tree: "files",
  file: "files",
  root: "files",
  git: "git",
  branches: "git",
  log: "git",
  commit: "git",
  "commit-diff": "git",
  diff: "git",
  gutter: "git",
  search: "search",
  paths: "files",
  issues: "issues",
  issue: "issues",
  pulls: "pulls",
  pull: "pulls",
  "pull-files": "pulls",
  "pull-diff": "pulls",
  changes: "files",
  "compare-file": "files",
  discussions: "discussions",
  discussion: "discussions",
  pipelines: "pipelines",
  pipeline: "pipelines",
  job: "pipelines",
  releases: "releases",
  release: "releases",
};
export function readProviderFor(profile: WorkspaceProfile, action: string): ReadProvider {
  const domain = READ_DOMAIN[action];
  if (!domain) throw new Error(`Неизвестное действие workspace: ${action}`);
  const provider = profile.providers[domain];
  if (!provider) throw new Error("Действие недоступно для этого проекта");
  return provider;
}

/** Resolves a profile from a project id; the first matching resolver wins, `local` is last. */
export interface WorkspaceProfileResolver {
  match(projectId: string): boolean;
  create(projectId: string): WorkspaceProfile;
}
export interface WorkspaceProfiles {
  resolve(projectId: string): WorkspaceProfile;
  /** Mounted views publish a ready profile and withdraw it on unmount. */
  register(projectId: string, profile: WorkspaceProfile): () => void;
}
export function createWorkspaceProfiles(
  resolvers: WorkspaceProfileResolver[],
  fallback: (projectId: string) => WorkspaceProfile,
): WorkspaceProfiles {
  const registered = new Map<string, WorkspaceProfile>();
  const created = new Map<string, WorkspaceProfile>();
  return {
    resolve(projectId) {
      const profile = registered.get(projectId);
      if (profile) return profile;
      let cached = created.get(projectId);
      if (!cached) {
        cached = (resolvers.find((item) => item.match(projectId))?.create ?? fallback)(projectId);
        created.set(projectId, cached);
      }
      return cached;
    },
    register(projectId, profile) {
      registered.set(projectId, profile);
      return () => {
        if (registered.get(projectId) === profile) registered.delete(projectId);
      };
    },
  };
}
