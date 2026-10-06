import { github, repositoryName } from "./api.ts";
import { integrationConfig } from "../integration-store/index.ts";
import { HttpError } from "../http/index.ts";
import type {
  GithubRepository,
  GithubEntry,
  GithubFile,
} from "../../../core/modules/github/index.ts";

export async function githubReader(repository: string) {
  const name = repositoryName(repository);
  const config = await integrationConfig("github");
  const token = config.enabled ? config.credentials.token || "" : "";
  return <T>(path: string) => github<T>(`/repos/${name}${path}`, token);
}
function objectId(sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new HttpError(400, "Неверный Git object ID");
  return sha;
}
export async function browseGithubRepository(
  repository: string,
  ref = "",
): Promise<GithubRepository> {
  const get = await githubReader(repository);
  const repo = await get<{
    full_name: string;
    description?: string | null;
    default_branch: string;
    private: boolean;
    size: number;
    owner?: { login?: string; avatar_url?: string };
    html_url?: string;
    stargazers_count?: number;
    forks_count?: number;
    subscribers_count?: number;
    open_issues_count?: number;
    language?: string | null;
    license?: { spdx_id?: string | null; name?: string } | null;
    homepage?: string | null;
    topics?: string[];
    created_at?: string;
    updated_at?: string;
  }>("");
  const branch = ref || repo.default_branch;
  const license =
    repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION"
      ? repo.license.spdx_id
      : repo.license?.name || "";
  const result = {
    fullName: repo.full_name,
    description: repo.description || "",
    branch,
    private: repo.private,
    owner: repo.owner?.login || repo.full_name.split("/")[0] || "",
    avatarUrl: repo.owner?.avatar_url || "",
    htmlUrl: repo.html_url || `https://github.com/${repo.full_name}`,
    defaultBranch: repo.default_branch,
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    watchers: repo.subscribers_count ?? 0,
    openIssues: repo.open_issues_count ?? 0,
    language: repo.language || "",
    license,
    homepage: repo.homepage || "",
    topics: Array.isArray(repo.topics) ? repo.topics : [],
    createdAt: repo.created_at || "",
    updatedAt: repo.updated_at || "",
  };
  try {
    const commit = await get<{ sha: string; commit: { tree: { sha: string } } }>(
      `/commits/${encodeURIComponent(branch)}`,
    );
    return { ...result, commit: commit.sha, tree: commit.commit.tree.sha, empty: false };
  } catch (error) {
    if (
      !ref &&
      error instanceof HttpError &&
      (error.status === 409 || (error.status === 404 && repo.size === 0))
    )
      return { ...result, commit: "", tree: "", empty: true };
    throw error;
  }
}
export async function browseGithubTree(
  repository: string,
  sha: string,
): Promise<{ entries: GithubEntry[]; truncated: boolean }> {
  objectId(sha);
  const get = await githubReader(repository);
  const data = await get<{
    tree: Array<{
      path: string;
      sha: string;
      type: GithubEntry["type"];
      mode: string;
      size?: number;
    }>;
    truncated: boolean;
  }>(`/git/trees/${sha}`);
  return {
    entries: data.tree
      .map((entry) => ({
        name: entry.path,
        sha: entry.sha,
        type: entry.type,
        mode: entry.mode,
        size: entry.size ?? 0,
      }))
      .sort(
        (a, b) =>
          Number(b.type === "tree") - Number(a.type === "tree") || a.name.localeCompare(b.name),
      ),
    truncated: data.truncated,
  };
}
const LIMIT = 5 * 1024 * 1024;
export async function browseGithubFile(
  repository: string,
  sha: string,
  path: string,
): Promise<GithubFile> {
  objectId(sha);
  const get = await githubReader(repository);
  const blob = await get<{ content: string; encoding: string; size: number }>(`/git/blobs/${sha}`);
  if (blob.size > LIMIT) throw new HttpError(413, "Просмотр файлов больше 5 MiB пока недоступен");
  if (blob.encoding !== "base64")
    throw new HttpError(400, "GitHub вернул неподдерживаемую кодировку");
  const bytes = Buffer.from(blob.content, "base64");
  const extension = path.split(".").pop()?.toLowerCase() || "";
  const mime = (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
      ico: "image/x-icon",
      svg: "image/svg+xml",
    } as Record<string, string>
  )[extension];
  const content = bytes.toString("utf8");
  const binary = bytes.includes(0) || !Buffer.from(content).equals(bytes);
  return {
    content: binary ? "" : content,
    image: mime ? `data:${mime};base64,${bytes.toString("base64")}` : null,
    binary,
    size: bytes.length,
  };
}

export async function browseGithubAsset(repository: string, root: string, path: string) {
  objectId(root);
  const parts = path.split("/");
  if (
    parts.some((part) => !part || part === "." || part === "..") ||
    path.includes("\\") ||
    path.includes("\0")
  )
    throw new HttpError(400, "Неверный путь изображения");
  let sha = root;
  for (const [index, name] of parts.entries()) {
    const data = await browseGithubTree(repository, sha);
    const entry = data.entries.find((item) => item.name === name);
    if (!entry) throw new HttpError(404, "Изображение не найдено");
    if (index < parts.length - 1) {
      if (entry.type !== "tree") throw new HttpError(404, "Папка не найдена");
      sha = entry.sha;
    } else {
      if (entry.type !== "blob" || entry.mode === "120000")
        throw new HttpError(400, "Выберите изображение");
      if (entry.size > LIMIT) throw new HttpError(413, "Изображение больше 5 MiB");
      const file = await browseGithubFile(repository, entry.sha, path);
      if (!file.image) throw new HttpError(400, "Неподдерживаемое изображение");
      const [header, content] = file.image.split(",");
      return { mime: header!.slice(5).split(";")[0]!, bytes: Buffer.from(content!, "base64") };
    }
  }
  throw new HttpError(404, "Изображение не найдено");
}
