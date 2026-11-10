import { HttpError } from "../http/index.ts";
import type {
  FileChange,
  FileChangeList,
  FileSides,
} from "@projector-ai/core/modules/workspace/index.ts";
import { gitlabReader } from "./api.ts";
import {
  diffCounts,
  diffStatus,
  isBinaryDiff,
  projectId,
  readGitlabFileAt,
  type ApiDiff,
} from "./browser.ts";

function fileChange(file: ApiDiff): FileChange {
  const kind = diffStatus(file);
  const counts = file.diff ? diffCounts(file.diff) : { additions: 0, deletions: 0 };
  return {
    path: file.new_path,
    kind:
      kind === "A"
        ? "added"
        : kind === "D"
          ? "deleted"
          : kind === "R"
            ? "renamed"
            : kind === "C"
              ? "copied"
              : "modified",
    ...(file.old_path && file.old_path !== file.new_path ? { originalPath: file.old_path } : {}),
    additions: counts.additions,
    deletions: counts.deletions,
    ...(isBinaryDiff(file) ? { binary: true } : {}),
    ...(file.too_large ? { tooLarge: true } : {}),
    ...(file.generated_file ? { generated: true } : {}),
  };
}

function revision(value: string) {
  if (!/^[a-f0-9]{7,40}$/i.test(value)) throw new HttpError(400, "Некорректный хеш коммита");
  return value;
}

/** Changed paths of two refs through the host comparison API. */
export async function browseGitlabCompareChanges(
  repository: string,
  from: string,
  to: string,
): Promise<FileChangeList> {
  from = revision(from);
  to = revision(to);
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const data = await reader.get<{
    diffs?: ApiDiff[];
    compare_timeout?: boolean;
    compare_same_ref?: boolean;
  }>(`/projects/${id}/repository/compare?${new URLSearchParams({ from, to })}`);
  if (data.compare_same_ref) return { changes: [], truncated: false };
  return {
    changes: (data.diffs ?? []).map(fileChange),
    truncated: data.compare_timeout === true,
  };
}

/** Two text sides of one path between refs; a missing side is empty. */
export async function browseGitlabCompareFile(
  repository: string,
  from: string,
  to: string,
  path: string,
  originalPath = path,
): Promise<FileSides> {
  from = revision(from);
  to = revision(to);
  const reader = await gitlabReader(repository);
  const id = projectId(reader.target.path);
  const read = async (ref: string, file: string) => {
    try {
      const data = await readGitlabFileAt(reader, id, ref, file);
      if (data.binary) throw new HttpError(415, "Бинарный файл нельзя сравнить как текст");
      return data.content;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return "";
      throw error;
    }
  };
  const [original, modified] = await Promise.all([read(from, originalPath), read(to, path)]);
  if (!original && !modified) throw new HttpError(404, "Файл не найден в этом сравнении");
  return { path, original, modified };
}
