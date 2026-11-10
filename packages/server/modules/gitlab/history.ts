import { HttpError } from "../http/index.ts";
import type {
  CommitComparison,
  GitCommitDetail,
  GitLog,
} from "@projector-ai/core/modules/workspace/index.ts";
import { gitlabReader, type GitlabPage, type GitlabReader } from "./api.ts";
import {
  browseGitlabFile,
  commitRow,
  diffCounts,
  diffStatus,
  DIFF_LIMIT,
  isBinaryDiff,
  LOG_PAGE_SIZE,
  nextPage,
  projectId,
  safePath,
  SEARCH_LIMIT,
  type ApiCommit,
  type ApiDiff,
} from "./browser.ts";

async function searchCommits(
  reader: GitlabReader,
  query: string,
  page: number,
): Promise<GitlabPage<ApiCommit[]>> {
  if ((page - 1) * LOG_PAGE_SIZE >= SEARCH_LIMIT)
    throw new HttpError(413, `Поиск GitLab ограничен ${SEARCH_LIMIT} коммитами`);
  const params = new URLSearchParams({
    scope: "commits",
    search: query,
    per_page: String(LOG_PAGE_SIZE),
    page: String(page),
  });
  try {
    return await reader.request<ApiCommit[]>(
      `/projects/${projectId(reader.target.path)}/search?${params}`,
    );
  } catch (error) {
    if (error instanceof HttpError && (error.status === 400 || error.status === 404))
      throw new HttpError(400, "Поиск коммитов GitLab недоступен на этом инстансе");
    throw error;
  }
}

async function logPage(reader: GitlabReader, sha: string, page: number) {
  const params = new URLSearchParams({
    per_page: String(LOG_PAGE_SIZE),
    page: String(page),
    with_stats: "true",
  });
  if (sha) params.set("ref_name", sha);
  return reader.request<ApiCommit[]>(
    `/projects/${projectId(reader.target.path)}/repository/commits?${params}`,
  );
}

export async function browseGitlabLog(
  repository: string,
  params: Record<string, string>,
): Promise<GitLog> {
  const page = Number(params.page || 1);
  if (!Number.isSafeInteger(page) || page < 1)
    throw new HttpError(400, "Неверная страница истории");
  const query = (params.query || params.q || "").trim();
  const reader = await gitlabReader(repository);
  const response = query
    ? await searchCommits(reader, query, page)
    : await logPage(reader, params.sha || "", page);
  const rows = Array.isArray(response.data) ? response.data : [];
  return {
    available: true,
    head: params.sha || (page === 1 ? commitRow(rows[0] ?? {}).hash : ""),
    upstream: "",
    ahead: 0,
    behind: 0,
    me: "",
    commits: rows.map(commitRow),
    next: nextPage(response.headers, page, rows.length, LOG_PAGE_SIZE),
  };
}

async function commitDetail(reader: GitlabReader, hash: string) {
  if (!/^[a-f0-9]{7,40}$/i.test(hash)) throw new HttpError(400, "Некорректный хеш коммита");
  const id = projectId(reader.target.path);
  const data = await reader.get<ApiCommit>(
    `/projects/${id}/repository/commits/${encodeURIComponent(hash)}?stats=true`,
  );
  const diffs: ApiDiff[] = [];
  let page = 1;
  let more = false;
  for (let fetched = 0; fetched < DIFF_LIMIT / 100; fetched++) {
    const response = await reader.request<ApiDiff[]>(
      `/projects/${id}/repository/commits/${encodeURIComponent(hash)}/diff?per_page=100&page=${page}`,
    );
    const rows = Array.isArray(response.data) ? response.data : [];
    diffs.push(...rows);
    const next = nextPage(response.headers, page, rows.length, 100);
    more = next !== null;
    if (!next) break;
    page = next;
  }
  if (more || diffs.length > DIFF_LIMIT)
    throw new HttpError(413, `GitLab ограничивает сравнение коммита ${DIFF_LIMIT} файлами`);
  return { data, diffs };
}

export async function browseGitlabCommit(
  repository: string,
  hash: string,
): Promise<GitCommitDetail> {
  const reader = await gitlabReader(repository);
  const { data, diffs } = await commitDetail(reader, hash);
  const files = diffs.map((file) => {
    const counts = file.diff ? diffCounts(file.diff) : { additions: 0, deletions: 0 };
    return {
      path: file.new_path,
      originalPath: file.old_path === file.new_path ? undefined : file.old_path,
      status: diffStatus(file),
      additions: counts.additions,
      deletions: counts.deletions,
      binary: isBinaryDiff(file),
    };
  });
  const body = (data.message || "").split("\n").slice(1).join("\n").trim();
  return {
    ...commitRow(data),
    body,
    committer: data.committer_name || "",
    committerDate: data.committed_date || "",
    additions: data.stats?.additions ?? files.reduce((sum, file) => sum + file.additions, 0),
    deletions: data.stats?.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function browseGitlabComparison(
  repository: string,
  hash: string,
  path: string,
): Promise<CommitComparison> {
  safePath(path);
  const reader = await gitlabReader(repository);
  const { data, diffs } = await commitDetail(reader, hash);
  const file = diffs.find((item) => item.new_path === path || item.old_path === path);
  if (!file) throw new HttpError(404, "Файл не входит в этот коммит");
  if (isBinaryDiff(file)) throw new HttpError(415, "Бинарный файл нельзя сравнить как текст");
  const parent = data.parent_ids?.[0] || "";
  const read = async (ref: string, name: string) => {
    const content = await browseGitlabFile(repository, ref, name);
    if (content.binary) throw new HttpError(415, "Бинарный файл нельзя сравнить как текст");
    return content.content;
  };
  const [original, modified] = await Promise.all([
    file.new_file || !parent ? "" : read(parent, file.old_path),
    file.deleted_file ? "" : read(data.id || data.sha || hash, file.new_path),
  ]);
  return {
    path,
    original,
    modified,
    hash: data.id || data.sha || hash,
    parent: parent.slice(0, 7),
  };
}
