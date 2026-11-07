import { fetchRemoteIcon, HTML_FILES, remoteIconCandidates } from "../projects/index.ts";
import { gitlabReader, type GitlabReader } from "./api.ts";
import { browseGitlabAsset, nextPage, projectId, readGitlabFileAt } from "./browser.ts";

interface TreeBlob {
  path: string;
  type: string;
}

/** GitLab may return `/uploads/...` instead of an absolute avatar URL. */
function absoluteUrl(value: string, base: string): string {
  if (!value) return "";
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

const ICON_TREE_LIMIT = 5000;

async function gitlabIconPaths(reader: GitlabReader, ref: string): Promise<string[]> {
  const paths: string[] = [];
  let page = 1;
  for (let fetched = 0; fetched < 50; fetched++) {
    const params = new URLSearchParams({
      recursive: "true",
      per_page: "100",
      page: String(page),
    });
    if (ref) params.set("ref", ref);
    const response = await reader.request<TreeBlob[]>(
      `/projects/${projectId(reader.target.path)}/repository/tree?${params}`,
    );
    const rows = Array.isArray(response.data) ? response.data : [];
    for (const row of rows) if (row.type === "blob") paths.push(row.path);
    if (paths.length >= ICON_TREE_LIMIT) break;
    const next = nextPage(response.headers, page, rows.length, 100);
    if (!next) break;
    page = next;
  }
  return paths;
}

/**
 * Project logo from the repository itself: an icon linked by its HTML pages or one of the usual
 * favicon/logo files. `null` means the repository has no such file.
 */
export async function browseGitlabIcon(
  repository: string,
  ref = "",
): Promise<{ mime: string; bytes: Buffer } | null> {
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const project = await reader.get<{
    default_branch?: string;
    avatar_url?: string;
    namespace?: { avatar_url?: string };
    owner?: { avatar_url?: string };
  }>(`/projects/${id}`);
  const avatar =
    project.avatar_url || project.namespace?.avatar_url || project.owner?.avatar_url || "";
  const logo = await fetchRemoteIcon(absoluteUrl(avatar, reader.target.base));
  if (logo) return logo;
  const branch = ref || project.default_branch || "";
  if (!branch) return null;
  const paths = new Set(await gitlabIconPaths(reader, branch));
  const pages: Array<{ path: string; content: string }> = [];
  for (const path of HTML_FILES) {
    if (!paths.has(path)) continue;
    const file = await readGitlabFileAt(reader, id, branch, path).catch(() => null);
    if (file && !file.binary) pages.push({ path, content: file.content });
  }
  const iconPath = remoteIconCandidates(pages, paths)[0];
  return iconPath ? browseGitlabAsset(repository, branch, iconPath) : null;
}
