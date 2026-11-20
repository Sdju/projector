import {
  createWorkspaceProfiles,
  profileCapabilities,
  readProviderFor,
  type WorkspaceProfile,
  type WorkspaceProfileResolver,
  type WorkspaceWatchPatch,
  type WorkspaceWatchHandlers,
} from "./profile.ts";
import type {
  WorkspaceParams,
  WorkspaceReadAction,
  WorkspaceReadResult,
  WorkspaceRequestArgs,
  WorkspaceScopeReadAction,
  WorkspaceScopeRequestArgs,
} from "./actions.ts";
import {
  fileScopeQuery,
  isLiveScope,
  type FileScope,
  type SearchOptions,
  type TrashDirectory,
  type TrashList,
} from "@ai-projector/core/modules/workspace/index.ts";
import { verifyPullDiff } from "./pull-diff.ts";
import { createLocalWorkspaceProfile } from "./local.ts";
export {
  READ_ACTION_DOMAINS,
  type WorkspaceEntryInfo,
  type WorkspaceParams,
  type WorkspaceReadAction,
  type WorkspaceReadActions,
  type WorkspaceReadDomain,
  type WorkspaceReadParams,
  type WorkspaceReadResult,
  type WorkspaceRequestArgs,
  type WorkspaceScopeReadAction,
  type WorkspaceScopeReadActions,
  type WorkspaceScopeReadParams,
  type WorkspaceScopeRequestArgs,
} from "./actions.ts";
export { createBrowseReader, WorkspaceRequestError, type BrowseReader } from "./transport.ts";
export {
  connectionFilesProvider,
  numberedReadProvider,
  readonlyFileContent,
  readonlyWorkspaceFeatures,
  snapshotGitProvider,
  snapshotTreePage,
  WORKSPACE_ACTION_UNAVAILABLE,
} from "./providers.ts";
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
  type WorkspaceWatch,
  type WorkspaceWatchPatch,
  type WorkspaceWatchHandlers,
} from "./profile.ts";
export { createLocalWorkspaceProfile } from "./local.ts";
export {
  groupPipelineStages,
  PIPELINE_PROBLEM_STATUSES,
  type PipelineStageGroup,
  type PipelineStageTone,
} from "./pipeline-stages.ts";
export {
  createSidebarRegistry,
  workspaceAside,
  workspaceUtility,
  type SidebarRegistry,
  type SidebarType,
} from "./sidebar.ts";
export { extendSidebarRegistry, groupSidebar } from "./sidebar.ts";
export {
  ciTabParams,
  createTabRegistry,
  defineTab,
  idTab,
  inboxTab,
  numberedTab,
  singletonTab,
  tabRecordId,
  type TabBehavior,
  type TabParams,
  type TabRegistry,
  type TabType,
} from "./tabs.ts";

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
/** Asset URL of a snapshot; live keeps the ordinary project asset URL. */
export function workspaceScopeAssetUrl(projectId: string, scope: FileScope, path: string) {
  if (isLiveScope(scope)) return workspaceAssetUrl(projectId, path);
  const url = workspaceProfile(projectId).providers.files.scopeAssetUrl?.(scope, path);
  if (!url) throw new Error("Источник не умеет отдавать вложения снимка");
  return url;
}
export const workspaceSiteUrl = (projectId: string, path: string) =>
  workspaceProfile(projectId).providers.files.siteUrl?.(path) ?? "";
export const refreshWorkspace = (projectId: string) =>
  workspaceProfile(projectId).providers.files.refresh?.();

export const workspaceWatchable = (projectId: string) =>
  !!workspaceProfile(projectId).providers.files.watch;

/** Shows an entry in the file manager of the server's desktop; unsupported sources have no reveal. */
export function revealWorkspaceEntry(projectId: string, path: string) {
  const { files } = workspaceProfile(projectId).providers;
  if (!files.reveal) throw new Error("Проводник недоступен для этого проекта");
  return files.reveal(path);
}

/**
 * Сообщает провайдеру открытые файлы (`paths`) и раскрытые папки (`directories`).
 * Пропущенное поле остаётся как было; изменения приходят через `subscribeWorkspace`.
 */
export function watchWorkspace(projectId: string, patch: WorkspaceWatchPatch, keepalive = false) {
  return (
    workspaceProfile(projectId).providers.files.watch?.update(patch, keepalive) ??
    Promise.resolve(false)
  );
}

export function subscribeWorkspace(projectId: string, handlers: WorkspaceWatchHandlers) {
  return workspaceProfile(projectId).providers.files.watch?.subscribe(handlers) ?? (() => {});
}

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

/** Приватный транспорт: провайдер видит строковое действие, типы проверяются на публичных входах. */
async function readAction<R>(
  projectId: string,
  action: WorkspaceReadAction,
  params: unknown,
  signal?: AbortSignal,
): Promise<R> {
  const provider = readProviderFor(workspaceProfile(projectId), action);
  const args = (params ?? {}) as WorkspaceParams;
  const result = await provider.read(action, args, signal);
  if (action === "pull-diff") verifyPullDiff(args, result);
  return result as R;
}

/** Читает действие workspace; имя действия связывает параметры и тип ответа. */
export function workspaceRequest<K extends WorkspaceReadAction>(
  projectId: string,
  action: K,
  ...[params, signal]: WorkspaceRequestArgs<K>
): Promise<WorkspaceReadResult<K>> {
  return readAction<WorkspaceReadResult<K>>(projectId, action, params, signal);
}

/**
 * Reads a workspace action from a file scope. The action keeps its name (`tree`, `file`, `diff`);
 * the scope contributes only its parameters, so call sites never spell out `rev` or `from/to`.
 */
export function workspaceScopeRequest<K extends WorkspaceScopeReadAction>(
  projectId: string,
  scope: FileScope,
  action: K,
  ...[params, signal]: WorkspaceScopeRequestArgs<K>
): Promise<WorkspaceReadResult<K>> {
  return readAction<WorkspaceReadResult<K>>(
    projectId,
    action,
    { ...params, ...fileScopeQuery(scope) },
    signal,
  );
}

export function searchWorkspace(
  projectId: string,
  query: string,
  options: SearchOptions,
  signal?: AbortSignal,
  scope?: FileScope,
) {
  const params = {
    q: query,
    case: String(!!options.caseSensitive),
    word: String(!!options.wholeWord),
    regex: String(!!options.regex),
  };
  if (scope) return workspaceScopeRequest(projectId, scope, "search", params, signal);
  return workspaceRequest(projectId, "search", params, signal);
}

/** Files and folders of the project whose path matches the query, best first. */
export async function findWorkspacePaths(
  projectId: string,
  query: string,
  signal?: AbortSignal,
  scope?: FileScope,
  limit?: number,
) {
  const params = { q: query, ...(limit ? { limit: String(limit) } : {}) };
  const { paths } = scope
    ? await workspaceScopeRequest(projectId, scope, "paths", params, signal)
    : await workspaceRequest(projectId, "paths", params, signal);
  return paths;
}

export function gutterRequest(projectId: string, path: string, signal?: AbortSignal) {
  return workspaceRequest(projectId, "gutter", { path }, signal);
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

export interface ImportConflict {
  name: string;
  /** A name next to the taken one that is still free (`a (2).txt`). */
  free: string;
}
/** Which of the top-level names are already taken in the target folder. */
export async function checkWorkspaceImport(projectId: string, directory: string, names: string[]) {
  return (await fileWriter(projectId)(
    "import",
    { action: "check", directory, names },
    "Не удалось проверить имена",
  )) as { conflicts: ImportConflict[] };
}
/** Moves taken names to `.projector-trash` so the import can reuse them. */
export async function clearWorkspaceImport(projectId: string, directory: string, names: string[]) {
  await fileWriter(projectId)(
    "import",
    { action: "clear", directory, names },
    "Не удалось освободить имена",
  );
}
/** Copies files and folders by their disk paths; the sources stay as they are. */
export async function copyWorkspaceEntries(
  projectId: string,
  directory: string,
  entries: { source: string; name: string }[],
) {
  return (await fileWriter(projectId)(
    "import",
    { action: "copy", directory, entries },
    "Не удалось скопировать файлы",
  )) as { copied: string[] };
}
/** Browser files without a disk path can be uploaded only where the profile accepts uploads. */
export const workspaceCanUpload = (projectId: string) =>
  !!workspaceProfile(projectId).providers.files.upload;
export function uploadWorkspaceEntry(
  projectId: string,
  directory: string,
  path: string,
  body?: Blob,
  signal?: AbortSignal,
) {
  const upload = workspaceProfile(projectId).providers.files.upload;
  if (!upload) throw new Error(READONLY);
  return upload(directory, path, body, signal);
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

/** Корневой список корзины: без `path` хост отдаёт записи, а не уровень дерева. */
export async function listWorkspaceTrash(
  projectId: string,
  signal?: AbortSignal,
): Promise<TrashList> {
  return (await workspaceRequest(projectId, "trash", {}, signal)) as TrashList;
}

/** One level of a trashed folder, fetched when the tree row is expanded. */
export async function listWorkspaceTrashDirectory(
  projectId: string,
  path: string,
  signal?: AbortSignal,
): Promise<TrashDirectory> {
  return (await workspaceRequest(projectId, "trash", { path }, signal)) as TrashDirectory;
}

/** Recursive sizes of the direct children of a trash folder; `""` means the trash root. */
export function workspaceTrashSizes(projectId: string, path = "", signal?: AbortSignal) {
  return workspaceRequest(projectId, "trash-sizes", { path }, signal);
}

/** Restores or permanently deletes trash entries; permanent deletion needs `confirm`. */
export async function mutateWorkspaceTrash(
  projectId: string,
  action: "restore" | "delete" | "empty",
  ids: string[] = [],
  confirm = false,
) {
  return (await fileWriter(projectId)(
    "trash",
    { action, ids, confirm },
    "Не удалось выполнить действие с корзиной",
  )) as import("@ai-projector/core/modules/workspace/index.ts").TrashMutation;
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
  )) as import("@ai-projector/core/modules/workspace/index.ts").GitOverview;
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
  )) as import("@ai-projector/core/modules/workspace/index.ts").GitBranches;
}

export async function mutateWorkspaceSync(
  projectId: string,
  action: import("@ai-projector/core/modules/workspace/index.ts").GitSyncAction,
) {
  return (await gitWriter(projectId)(
    "sync",
    { action },
    "Не удалось синхронизировать репозиторий",
  )) as import("@ai-projector/core/modules/workspace/index.ts").GitSync;
}
