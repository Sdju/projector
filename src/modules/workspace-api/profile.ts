import type { SidebarType } from "./sidebar.ts";
import type { TabType } from "./tabs.ts";

export type WorkspaceCapability =
  | "write"
  | "git"
  | "search"
  | "issues"
  | "pulls"
  | "discussions"
  | "terminals"
  | "docker"
  | "agent"
  | "settings"
  | "persist"
  | "externalFiles";
export type WorkspaceCapabilities = Record<WorkspaceCapability, boolean>;

export type WorkspaceParams = Record<string, string>;
export interface ReadProvider {
  read(action: string, params: WorkspaceParams, signal?: AbortSignal): Promise<unknown>;
}
export type FileWrite = "file" | "move" | "entry";
export interface FilesProvider extends ReadProvider {
  assetUrl(path: string, external?: boolean): string;
  /** Address that serves the file as part of a site (relative links resolve); absent when it cannot. */
  siteUrl?(path: string): string;
  /** Present only when the files can change. */
  write?(endpoint: FileWrite, body: unknown, failure?: string): Promise<unknown>;
  /** Re-reads a mutable snapshot (a remote ref moved). */
  refresh?(): Promise<void>;
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
    });
    capabilityCache.set(profile, capabilities);
  }
  return capabilities;
}

/** Which provider serves a read action; the table is the only place that knows the split. */
const READ_DOMAIN: Record<string, "files" | "git" | "search" | "issues" | "pulls" | "discussions"> = {
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
  issues: "issues",
  issue: "issues",
  pulls: "pulls",
  pull: "pulls",
  discussions: "discussions",
  discussion: "discussions",
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
