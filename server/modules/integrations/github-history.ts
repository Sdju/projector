import { githubReader, browseGithubFile, browseGithubTree } from "./github-browser.ts";
import { HttpError } from "../http/index.ts";
import type {
  GitCommit,
  GitCommitDetail,
  GitLog,
  CommitComparison,
} from "../../../core/modules/workspace/index.ts";

interface RemoteCommit {
  sha: string;
  parents: Array<{ sha: string }>;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
    committer: { name: string; date: string };
  };
  files: Array<{
    filename: string;
    previous_filename?: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}
function hash(value: string) {
  if (!/^[a-f0-9]{7,40}$/.test(value)) throw new HttpError(400, "Некорректный хеш коммита");
  return value;
}
function commit(data: RemoteCommit): GitCommit {
  return {
    hash: data.sha,
    parents: data.parents.map((parent) => parent.sha),
    subject: data.commit.message.split("\n")[0] || "",
    author: data.commit.author.name,
    email: data.commit.author.email,
    date: data.commit.author.date,
    refs: [],
    unpushed: false,
  };
}
/** Cursor counts inspected commits, so filtering can continue without skipping matches. */
export async function browseGithubLog(
  repository: string,
  params: Record<string, string>,
): Promise<GitLog> {
  const head = params.sha ? hash(params.sha) : "";
  const result: GitLog = {
    available: true,
    head,
    upstream: "",
    ahead: 0,
    behind: 0,
    me: "",
    commits: [],
    next: null,
  };
  if (!head) return result;
  if (params.all === "true")
    throw new HttpError(400, "Этот источник поддерживает историю текущей ветки");
  const get = await githubReader(repository);
  let skip = Number(params.skip || 0);
  const limit = Number(params.limit || 50);
  if (
    !Number.isSafeInteger(skip) ||
    skip < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new HttpError(400, "Неверная страница истории");
  const query = (params.q || "").trim().toLowerCase();
  // Bound each request; sparse searches continue via the same pagination button.
  for (let batch = 0; batch < 5; batch++) {
    const offset = skip % 100;
    const data = await get<RemoteCommit[]>(
      `/commits?${new URLSearchParams({ sha: head, per_page: "100", page: String(Math.floor(skip / 100) + 1) })}`,
    );
    for (const item of data.slice(offset)) {
      const text = query.startsWith("@")
        ? `${item.commit.author.name} ${item.commit.author.email}`
        : item.commit.message;
      if (!query || text.toLowerCase().includes(query.startsWith("@") ? query.slice(1) : query)) {
        if (result.commits.length === limit) {
          result.next = skip;
          return result;
        }
        const row = commit(item);
        if (row.hash === head) row.refs = [{ name: "HEAD", kind: "head" }];
        result.commits.push(row);
      }
      skip++;
    }
    if (data.length < 100) return result;
  }
  result.next = skip;
  return result;
}
export async function browseGithubCommit(
  repository: string,
  value: string,
): Promise<GitCommitDetail> {
  const get = await githubReader(repository);
  const id = hash(value);
  let data: RemoteCommit | undefined;
  const files: RemoteCommit["files"] = [];
  // GitHub paginates commit files, with a documented ceiling of 3000.
  for (let page = 1; page <= 31; page++) {
    const next = await get<RemoteCommit>(`/commits/${id}?per_page=100&page=${page}`);
    data ??= next;
    files.push(...next.files);
    if (next.files.length < 100) break;
    if (page === 31) throw new HttpError(413, "Слишком много файлов для обзора коммита");
  }
  if (files.length >= 3000)
    throw new HttpError(413, "GitHub ограничивает обзор коммита 3000 файлами");
  return {
    ...commit(data!),
    body: data!.commit.message.split("\n").slice(1).join("\n").trim(),
    committer: data!.commit.committer.name,
    committerDate: data!.commit.committer.date,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files: files
      .map((file) => ({
        path: file.filename,
        originalPath: file.previous_filename,
        status:
          (
            { added: "A", removed: "D", renamed: "R", copied: "C", changed: "T" } as Record<
              string,
              string
            >
          )[file.status] || "M",
        additions: file.additions,
        deletions: file.deletions,
        binary: false,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}
export async function browseGithubComparison(
  repository: string,
  value: string,
  path: string,
): Promise<CommitComparison> {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new HttpError(400, "Неверный путь файла");
  const detail = await browseGithubCommit(repository, value);
  const file = detail.files.find((item) => item.path === path);
  if (!file) throw new HttpError(404, "Файл не входит в этот коммит");
  const get = await githubReader(repository);
  async function text(ref: string, filename: string) {
    const info = await get<{ tree: { sha: string } }>(`/git/commits/${ref}`);
    let sha = info.tree.sha;
    const parts = filename.split("/");
    for (const [index, name] of parts.entries()) {
      const directory = await browseGithubTree(repository, sha);
      if (directory.truncated) throw new HttpError(413, "GitHub вернул неполное дерево коммита");
      const entry = directory.entries.find((item) => item.name === name);
      if (!entry) throw new HttpError(404, "Файл не найден в коммите");
      if (index < parts.length - 1 ? entry.type !== "tree" : entry.type !== "blob")
        throw new HttpError(415, "Этот объект нельзя сравнить как текст");
      sha = entry.sha;
    }
    const blob = await browseGithubFile(repository, sha, filename);
    if (blob.binary) throw new HttpError(415, "Бинарный файл нельзя сравнить как текст");
    return blob.content;
  }
  const parent = detail.parents[0];
  const [original, modified] = await Promise.all([
    !parent || file.status === "A" ? "" : text(parent, file.originalPath || path),
    file.status === "D" ? "" : text(detail.hash, path),
  ]);
  return { path, original, modified, hash: detail.hash, parent: parent?.slice(0, 7) || "" };
}
