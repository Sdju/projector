import { LARGE_FILE_BYTES, largeFileQuestion } from "../../../../core/modules/workspace/index.ts";
import type { FileContent } from "../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../workspace-api/index.ts";

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
): Promise<(FileContent & { image?: boolean }) | undefined> {
  const read = (announce: boolean) =>
    workspaceRequest<FileContent & { image?: boolean }>(
      projectId,
      external ? "external" : "file",
      announce ? { path, ask: "1" } : { path },
    );
  const file = await read(ask);
  if (file.large === undefined) return file;
  if (!wanted() || !window.confirm(largeFileQuestion(path, file.large))) return undefined;
  return read(false);
}

/** A file picked from the system is not read by the server: the same question, by its size. */
export function confirmBrowserFile(source: File): boolean {
  return (
    source.size < LARGE_FILE_BYTES ||
    /\.(?:png|jpe?g|gif|webp|avif)$/i.test(source.name) ||
    window.confirm(largeFileQuestion(source.name, source.size))
  );
}
