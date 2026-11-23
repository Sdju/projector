import { trimDriveSlash } from "@ai-projector/core/modules/workspace/index.ts";

/** The local path of an absolute file URL, without the query and with the drive slash dropped. */
export function fileUrlPath(src: string): string | undefined {
  try {
    const url = new URL(src);
    let path = decodeURIComponent(url.pathname);
    // `file://localhost/...` is the same local file as `file:///...`.
    if (url.host && url.host !== "localhost") path = `//${url.host}${path}`;
    const local = trimDriveSlash(path);
    return local || undefined;
  } catch {
    return;
  }
}

/** Whether a path already points outside a project: absolute POSIX, Windows drive or UNC. */
export function isLocalPath(path: string): boolean {
  return path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
}

/** The absolute path of a project file; an already local path stays as it is. */
export function absoluteLocalPath(root: string, path: string): string {
  const local = trimDriveSlash(path);
  if (isLocalPath(local)) return local;
  const base = root.replace(/[\\/]+$/, "");
  return base ? `${base}/${local.replace(/^\.\//, "")}` : local;
}
