import { HttpError } from "../http/index.ts";
import type {
  GitlabEntry,
  GitlabFile,
  GitlabRepository,
} from "@projector/core/modules/gitlab/index.ts";
import type { GitCommit } from "@projector/core/modules/workspace/index.ts";
import { gitlabBytes, gitlabReader, type GitlabReader } from "./api.ts";

const FILE_LIMIT = 5 * 1024 * 1024;
const TREE_LIMIT = 1000;
export const DIFF_LIMIT = 300;
export const LOG_PAGE_SIZE = 30;
export const SEARCH_LIMIT = 500;
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "ico",
  "pdf",
  "zip",
  "gz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "tar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "wasm",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "class",
  "jar",
  "dat",
  "sqlite",
]);

interface ApiProject {
  path_with_namespace?: string;
  description?: string | null;
  default_branch?: string;
  visibility?: string;
  web_url?: string;
  http_url_to_repo?: string;
  avatar_url?: string;
  archived?: boolean;
  empty_repo?: boolean;
  star_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  open_merge_requests_count?: number;
  namespace?: { name?: string; full_path?: string; avatar_url?: string };
  owner?: { name?: string; avatar_url?: string };
  topics?: string[];
  license?: { name?: string; spdx_identifier?: string } | null;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string;
}
export interface ApiCommit {
  id?: string;
  sha?: string;
  short_id?: string;
  title?: string;
  message?: string;
  author_name?: string;
  author_email?: string;
  authored_date?: string;
  committer_name?: string;
  committer_email?: string;
  committed_date?: string;
  parent_ids?: string[];
  refs?: unknown[];
  stats?: { additions?: number; deletions?: number };
}
interface ApiTreeEntry {
  name: string;
  path: string;
  type: GitlabEntry["type"];
  mode?: string;
  size?: number;
}
export interface ApiDiff {
  old_path: string;
  new_path: string;
  new_file?: boolean;
  renamed_file?: boolean;
  deleted_file?: boolean;
  copied_file?: boolean;
  generated_file?: boolean;
  collapsed?: boolean;
  too_large?: boolean;
  a_mode?: string;
  b_mode?: string;
  diff?: string;
}
interface ApiFile {
  file_path?: string;
  size?: number;
  encoding?: string;
  content?: string;
}

export const projectId = (path: string) => encodeURIComponent(path);

function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() || "";
}

export function safePath(path: string, message = "Неверный путь файла") {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new HttpError(400, message);
  return path;
}

function safeTreePath(path: string) {
  return path ? safePath(path, "Неверный путь папки") : "";
}

/** Next page from `X-Next-Page`, with a length-based fallback for hosts without the header. */
export function nextPage(headers: Headers, page: number, count: number, size: number) {
  const raw = headers.get("X-Next-Page");
  if (raw !== null) {
    const next = Number(raw);
    return Number.isInteger(next) && next > page ? next : null;
  }
  return count === size ? page + 1 : null;
}

function refQuery(ref: string) {
  return ref ? `?${new URLSearchParams({ ref })}` : "";
}

function commitSubject(data: ApiCommit) {
  return data.title || data.message?.split("\n")[0] || "";
}

export function commitRow(data: ApiCommit): GitCommit {
  return {
    hash: data.id || data.sha || "",
    parents: data.parent_ids ?? [],
    subject: commitSubject(data),
    author: data.author_name || "",
    email: data.author_email || "",
    date: data.authored_date || "",
    refs: [],
    unpushed: false,
  };
}

export function diffCounts(diff = "") {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

export function diffStatus(file: ApiDiff) {
  if (file.new_file) return "A";
  if (file.deleted_file) return "D";
  if (file.copied_file) return "C";
  if (file.renamed_file || file.old_path !== file.new_path) return "R";
  if (file.a_mode && file.b_mode && file.a_mode.slice(0, 3) !== file.b_mode.slice(0, 3)) return "T";
  return "M";
}

export function isBinaryDiff(file: ApiDiff) {
  return !file.diff && BINARY_EXTENSIONS.has(extension(file.new_path || file.old_path));
}

/** GitLab returns namespace avatars as `/uploads/...` on some endpoints. */
function absoluteUrl(value: string, base: string) {
  if (!value) return "";
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

export async function browseGitlabRepository(
  repository: string,
  ref = "",
): Promise<GitlabRepository> {
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const project = await reader.get<ApiProject>(`/projects/${id}?license=true`);
  let languages: Record<string, number> = {};
  try {
    const value = await reader.get<Record<string, number> | null>(`/projects/${id}/languages`);
    if (value && typeof value === "object" && !Array.isArray(value)) languages = value;
  } catch {
    // Languages are optional: old instances and disabled endpoints must not break the card.
  }
  const defaultBranch = project.default_branch || "";
  const branch = ref || defaultBranch;
  let commit = "";
  let empty = project.empty_repo === true;
  if (!empty) {
    if (!branch) empty = true;
    else
      try {
        const head = await reader.get<ApiCommit>(
          `/projects/${id}/repository/commits/${encodeURIComponent(branch)}`,
        );
        commit = head.id || head.sha || "";
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) empty = true;
        else throw error;
      }
  }
  const visibility = project.visibility || "private";
  const fullName = project.path_with_namespace || reader.target.path;
  const webUrl = project.web_url || "";
  const avatar =
    project.avatar_url || project.namespace?.avatar_url || project.owner?.avatar_url || "";
  const primary =
    Object.entries(languages).sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))[0]?.[0] ??
    "";
  let openIssues = project.open_issues_count ?? 0;
  let openMergeRequests = project.open_merge_requests_count ?? 0;
  if (
    !empty &&
    (project.open_issues_count === undefined || project.open_merge_requests_count === undefined)
  ) {
    const [statistics, mergeRequests] = await Promise.all([
      project.open_issues_count === undefined
        ? reader
            .get<{ statistics?: { counts?: { opened?: number } } }>(
              `/projects/${id}/issues_statistics`,
            )
            .catch(() => null)
        : Promise.resolve(null),
      project.open_merge_requests_count === undefined
        ? reader
            .request<unknown>(`/projects/${id}/merge_requests?state=opened&per_page=1`)
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    const opened = statistics?.statistics?.counts?.opened;
    if (typeof opened === "number") openIssues = opened;
    const total = Number(mergeRequests?.headers.get("X-Total"));
    if (Number.isFinite(total)) openMergeRequests = total;
  }
  return {
    fullName,
    description: project.description || "",
    defaultBranch,
    branch,
    commit,
    private: visibility !== "public",
    empty,
    archived: project.archived === true,
    visibility,
    webUrl,
    httpUrlToRepo: project.http_url_to_repo || "",
    owner: project.namespace?.name || project.owner?.name || fullName.split("/")[0] || "",
    avatarUrl: absoluteUrl(avatar, webUrl || reader.target.base),
    stars: project.star_count ?? 0,
    forks: project.forks_count ?? 0,
    openIssues,
    openMergeRequests,
    language: primary,
    languages,
    license: project.license?.name || project.license?.spdx_identifier || "",
    homepage: "",
    topics: Array.isArray(project.topics) ? project.topics : [],
    createdAt: project.created_at || "",
    updatedAt: project.last_activity_at || project.updated_at || "",
  };
}

async function treePage(reader: GitlabReader, ref: string, path: string, page: number) {
  const params = new URLSearchParams({ path, per_page: "100", page: String(page) });
  if (ref) params.set("ref", ref);
  return reader.request<ApiTreeEntry[]>(
    `/projects/${projectId(reader.target.path)}/repository/tree?${params}`,
  );
}

export async function browseGitlabTree(
  repository: string,
  ref: string,
  path = "",
): Promise<{ entries: GitlabEntry[]; truncated: boolean }> {
  const reader = await gitlabReader(repository);
  const entries: GitlabEntry[] = [];
  const safe = safeTreePath(path);
  const pages = Math.ceil(TREE_LIMIT / 100);
  let truncated = false;
  let page = 1;
  for (let fetched = 0; fetched < pages; fetched++) {
    const response = await treePage(reader, ref, safe, page);
    const rows = Array.isArray(response.data) ? response.data : [];
    entries.push(...rows.map((row) => ({ ...row, mode: row.mode || "" })));
    const next = nextPage(response.headers, page, rows.length, 100);
    if (!next) break;
    if (fetched === pages - 1) {
      truncated = true;
      break;
    }
    page = next;
  }
  if (entries.length > TREE_LIMIT) {
    entries.length = TREE_LIMIT;
    truncated = true;
  }
  entries.sort(
    (left, right) =>
      Number(right.type === "tree") - Number(left.type === "tree") ||
      left.name.localeCompare(right.name),
  );
  return { entries, truncated };
}

export async function browseGitlabFile(
  repository: string,
  ref: string,
  path: string,
): Promise<GitlabFile> {
  const reader = await gitlabReader(repository);
  return readGitlabFileAt(reader, projectId(reader.target.path), ref, path);
}

/** Read one file from an already resolved project id or path; used for both sides of an MR diff. */
export async function readGitlabFileAt(
  reader: GitlabReader,
  project: string,
  ref: string,
  path: string,
): Promise<GitlabFile> {
  safePath(path);
  const file = await reader.get<ApiFile>(
    `/projects/${project}/repository/files/${encodeURIComponent(path)}${refQuery(ref)}`,
  );
  if ((file.size ?? 0) > FILE_LIMIT) throw new HttpError(413, "Файл больше 5 MiB");
  let bytes: Buffer;
  if (!file.encoding || file.encoding === "text") bytes = Buffer.from(file.content || "", "utf8");
  else if (file.encoding === "base64") bytes = Buffer.from(file.content || "", "base64");
  else throw new HttpError(400, "GitLab вернул неподдерживаемую кодировку");
  if (bytes.length > FILE_LIMIT) throw new HttpError(413, "Файл больше 5 MiB");
  const content = bytes.toString("utf8");
  const binary = bytes.includes(0) || !Buffer.from(content, "utf8").equals(bytes);
  const mime = IMAGE_MIME[extension(path)];
  return {
    content: binary ? "" : content,
    image: mime ? `data:${mime};base64,${bytes.toString("base64")}` : null,
    binary,
    size: bytes.length,
  };
}

export async function browseGitlabAsset(repository: string, ref: string, path: string) {
  safePath(path);
  const { target } = await gitlabReader(repository);
  const { bytes, headers } = await gitlabBytes(
    target.base,
    `/projects/${projectId(target.path)}/repository/files/${encodeURIComponent(path)}/raw${refQuery(ref)}`,
    target.token,
    { tokenType: target.tokenType },
  );
  const declared = Number(headers.get("Content-Length") || 0);
  if (declared > FILE_LIMIT || bytes.length > FILE_LIMIT)
    throw new HttpError(413, "Файл больше 5 MiB");
  const content = headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() || "";
  const mime =
    IMAGE_MIME[extension(path)] ||
    (content && content !== "application/octet-stream" ? content : "application/octet-stream");
  return { mime, bytes };
}
