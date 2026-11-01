import { markdownPath } from "../../../common/utilities/markdown-path.ts";
import { workspaceAssetUrl } from "../../workspace-api/index.ts";

/** Static routes of the app itself: they are served as they are, not as project files. */
const APP_ASSET = /^\/(?:api|assets|file-icons)(?:\/|$)/i;

/** A file outside the project, served by the workspace's `external-asset` endpoint. */
function externalAsset(projectId: string, path: string): string | undefined {
  if (!projectId) return;
  return workspaceAssetUrl(projectId, path, true) || undefined;
}

/** The local path of an absolute file URL, without the query and with the drive slash dropped. */
function fileUrlPath(src: string): string | undefined {
  try {
    const url = new URL(src);
    let path = decodeURIComponent(url.pathname);
    // `file://localhost/...` is the same local file as `file:///...`.
    if (url.host && url.host !== "localhost") path = `//${url.host}${path}`;
    if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1);
    return path || undefined;
  } catch {
    return;
  }
}

/** A filesystem path written as an absolute path, without a query or fragment. */
function localPath(src: string): string | undefined {
  const raw = src.split(/[?#]/)[0] ?? "";
  if (!raw) return;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Where a markdown image in a chat answer is loaded from: a project file goes through the
 * workspace `asset` endpoint, a file on disk through `external-asset`, and web, `data:` and `blob:`
 * sources stay as they are. Anything unsafe or unresolvable gives `undefined`.
 */
export function chatImageSource(src: string, projectId: string): string | undefined {
  const value = src.trim();
  if (!value) return;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (/^file:\/\//i.test(value)) {
    const path = fileUrlPath(value);
    return path ? externalAsset(projectId, path) : undefined;
  }
  if (/^[a-z]:[\\/]/i.test(value)) {
    const path = localPath(value);
    return path ? externalAsset(projectId, path) : undefined;
  }
  if (value.startsWith("/")) {
    if (APP_ASSET.test(value)) return value;
    const path = localPath(value);
    return path ? externalAsset(projectId, path) : undefined;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return;
  if (!projectId || value.includes("\\") || value.split("/").includes("..")) return;
  const path = markdownPath(value, "");
  if (!path) return;
  return workspaceAssetUrl(projectId, path) || undefined;
}
