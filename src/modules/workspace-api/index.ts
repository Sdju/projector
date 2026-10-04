import {
  createWorkspaceProfiles,
  profileCapabilities,
  readProviderFor,
  type WorkspaceProfile,
  type WorkspaceProfileResolver,
} from "./profile.ts";
import { createLocalWorkspaceProfile } from "./local.ts";
export {
  createWorkspaceProfiles,
  profileCapabilities,
  type WorkspaceCapability,
  type WorkspaceCapabilities,
  type WorkspaceProfile,
  type WorkspaceProfileResolver,
  type WorkspaceProfiles,
  type FilesProvider,
  type GitProvider,
  type ReadProvider,
} from "./profile.ts";
export { createLocalWorkspaceProfile } from "./local.ts";

/** Replaceable composition root: tests and new environments swap resolvers, not call sites. */
const resolvers: WorkspaceProfileResolver[] = [];
let profiles = createWorkspaceProfiles(resolvers, createLocalWorkspaceProfile);
export function useWorkspaceProfiles(next: typeof profiles) {
  profiles = next;
}
/** Adds an adapter that claims some project ids (GitHub, containers, ...). */
export function addWorkspaceProfileResolver(resolver: WorkspaceProfileResolver) {
  resolvers.push(resolver);
}
export const workspaceProfile = (projectId: string): WorkspaceProfile =>
  profiles.resolve(projectId);
export const registerWorkspaceProfile = (projectId: string, profile: WorkspaceProfile) =>
  profiles.register(projectId, profile);
export const workspaceCapabilities = (projectId: string) =>
  profileCapabilities(workspaceProfile(projectId));
export const workspaceAssetUrl = (projectId: string, path: string, external = false) =>
  workspaceProfile(projectId).providers.files.assetUrl(path, external);
export const refreshWorkspace = (projectId: string) =>
  workspaceProfile(projectId).providers.files.refresh?.();

const READONLY = "Проект открыт только для чтения";
function fileWriter(projectId: string) {
  const write = workspaceProfile(projectId).providers.files.write;
  if (!write) throw new Error(READONLY);
  return write;
}
function gitWriter(projectId: string) {
  const write = workspaceProfile(projectId).providers.git?.write;
  if (!write) throw new Error(READONLY);
  return write;
}

export async function workspaceRequest<T>(
  projectId: string,
  action: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const provider = readProviderFor(workspaceProfile(projectId), action);
  return (await provider.read(action, params, signal)) as T;
}

export function searchWorkspace(
  projectId: string,
  query: string,
  options: import("../../../core/modules/workspace/index.ts").SearchOptions,
  signal?: AbortSignal,
) {
  return workspaceRequest<{
    hits: import("../../../core/modules/workspace/index.ts").SearchHit[];
    truncated: boolean;
  }>(
    projectId,
    "search",
    {
      q: query,
      case: String(!!options.caseSensitive),
      word: String(!!options.wholeWord),
      regex: String(!!options.regex),
    },
    signal,
  );
}

export function gutterRequest(projectId: string, path: string, signal?: AbortSignal) {
  return workspaceRequest<import("../../../core/modules/workspace/index.ts").GitGutter>(
    projectId,
    "gutter",
    { path },
    signal,
  );
}

export async function saveWorkspaceFile(
  projectId: string,
  path: string,
  content: string,
  original: string,
) {
  return (await fileWriter(projectId)(
    "file",
    { path, content, original },
    "Не удалось сохранить файл",
  )) as { path: string; content: string };
}

export async function moveWorkspaceEntry(projectId: string, path: string, directory: string) {
  return (await fileWriter(projectId)(
    "move",
    { path, directory },
    "Не удалось перенести запись",
  )) as { source: string; destination: string };
}

export async function mutateWorkspaceEntry(
  projectId: string,
  action: string,
  path = "",
  directory = "",
  name = "",
) {
  return (await fileWriter(projectId)(
    "entry",
    { action, path, directory, name },
    "Не удалось выполнить действие",
  )) as { source?: string; destination?: string };
}

export async function mutateWorkspaceGit(
  projectId: string,
  action: string,
  path: string | string[],
) {
  return (await gitWriter(projectId)(
    "git",
    { action, ...(Array.isArray(path) ? { paths: path } : { path }) },
    "Не удалось выполнить действие Git",
  )) as import("../../../core/modules/workspace/index.ts").GitOverview;
}

export async function mutateWorkspaceBranch(
  projectId: string,
  action: string,
  input: { name?: string; newName?: string; from?: string; checkout?: boolean; force?: boolean },
) {
  return (await gitWriter(projectId)(
    "branch",
    { action, ...input },
    "Не удалось выполнить действие с веткой",
  )) as import("../../../core/modules/workspace/index.ts").GitBranches;
}
