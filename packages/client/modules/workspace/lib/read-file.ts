import {
  LARGE_FILE_BYTES,
  fileScopeQuery,
  isLiveScope,
  largeFileQuestion,
  type FileComparison,
  type FileContent,
  type FileScope,
  type FileSides,
} from "@projector-ai/core/modules/workspace/index.ts";
import { workspaceRequest, workspaceScopeRequest } from "../../workspace-api/index.ts";

/**
 * Reads a file for a new tab. A large one is announced first instead of read: the user is asked,
 * and `undefined` means they declined (or the tab was no longer wanted while they decided).
 */
export async function readFileConfirmed(
  projectId: string,
  path: string,
  external: boolean,
  ask: boolean,
  wanted: () => boolean,
  scope?: FileScope,
): Promise<(FileContent & { image?: boolean }) | undefined> {
  const read = (announce: boolean) =>
    workspaceRequest<FileContent & { image?: boolean }>(projectId, external ? "external" : "file", {
      path,
      ...(announce ? { ask: "1" } : {}),
      ...(scope ? fileScopeQuery(scope) : {}),
    });
  const file = await read(ask);
  if (file.large === undefined) return file;
  if (!wanted() || !window.confirm(largeFileQuestion(path, file.large))) return undefined;
  return read(false);
}

/** Picks the source of a new tab: a committed snapshot, a working file, or a Git diff. */
export async function readOpenData(
  projectId: string,
  path: string,
  options: {
    external: boolean;
    staged?: boolean;
    scope?: FileScope;
    originalPath?: string;
    ask: boolean;
    wanted: () => boolean;
  },
): Promise<(FileContent & { image?: boolean }) | FileComparison | FileSides | undefined> {
  if (options.scope?.kind === "compare")
    return workspaceScopeRequest<FileSides>(projectId, options.scope, "compare-file", {
      path,
      ...(options.originalPath ? { originalPath: options.originalPath } : {}),
    });
  if (options.scope && !isLiveScope(options.scope))
    return readFileConfirmed(projectId, path, false, options.ask, options.wanted, options.scope);
  if (options.staged === undefined)
    return readFileConfirmed(projectId, path, options.external, options.ask, options.wanted);
  return workspaceRequest<FileComparison>(projectId, "diff", {
    path,
    staged: String(options.staged),
  });
}

/** A file picked from the system is not read by the server: the same question, by its size. */
export function confirmBrowserFile(source: File): boolean {
  return (
    source.size < LARGE_FILE_BYTES ||
    /\.(?:png|jpe?g|gif|webp|avif)$/i.test(source.name) ||
    window.confirm(largeFileQuestion(source.name, source.size))
  );
}
