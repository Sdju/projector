import type {
  PullRequestComparison,
  PullRequestDiffRefs,
} from "@ai-projector/core/modules/workspace/index.ts";
import { HttpError } from "../http/index.ts";
import type { GitlabReader } from "./api.ts";
import { isBinaryDiff, readGitlabFileAt, type ApiDiff } from "./browser.ts";

interface ApiDiffVersion {
  id: number;
  base_commit_sha: string;
  head_commit_sha: string;
  diffs?: ApiDiff[];
}

function unavailableDiffVersion() {
  return new HttpError(409, "Эта версия diff merge request недоступна. Обновите карточку MR");
}

/** A version ID keeps the file metadata pinned even if a push lands between requests. */
export async function diffVersion(
  reader: GitlabReader,
  mr: string,
  headSha: string,
  baseSha: string,
) {
  const matches = (version: ApiDiffVersion) =>
    version.head_commit_sha === headSha && (!baseSha || version.base_commit_sha === baseSha);
  try {
    const versions = await reader.get<ApiDiffVersion[]>(`${mr}/versions`);
    const matching = (Array.isArray(versions) ? versions : []).filter(matches);
    const version = matching[0];
    if (!version || matching.some((item) => item.base_commit_sha !== version.base_commit_sha))
      throw unavailableDiffVersion();
    const detail = await reader.get<ApiDiffVersion>(`${mr}/versions/${version.id}`);
    if (
      !matches(detail) ||
      detail.base_commit_sha !== version.base_commit_sha ||
      !Array.isArray(detail.diffs)
    )
      throw unavailableDiffVersion();
    return {
      refs: { headSha, baseSha: detail.base_commit_sha },
      diffs: detail.diffs,
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw unavailableDiffVersion();
    throw error;
  }
}

export async function readDiffFile(
  reader: GitlabReader,
  id: string,
  headProject: string,
  refs: Pick<PullRequestDiffRefs, "headSha" | "baseSha">,
  diffs: ApiDiff[],
  path: string,
  pinned: boolean,
): Promise<PullRequestComparison> {
  const file = diffs.find((item) => item.new_path === path || item.old_path === path);
  if (!file) throw new HttpError(404, "Файл не входит в этот merge request");
  const base = {
    hash: refs.headSha,
    parent: refs.baseSha.slice(0, 7),
    ...(pinned ? { baseSha: refs.baseSha } : {}),
  };
  if (file.too_large === true)
    return { path, original: "", modified: "", ...base, binary: false, tooLarge: true };
  if (isBinaryDiff(file))
    return { path, original: "", modified: "", ...base, binary: true, tooLarge: false };
  const read = async (project: string, ref: string, name: string) => {
    try {
      return await readGitlabFileAt(reader, project, ref, name);
    } catch (error) {
      if (error instanceof HttpError && error.status === 413) return undefined;
      if (pinned && error instanceof HttpError && error.status === 404)
        throw unavailableDiffVersion();
      throw error;
    }
  };
  const [originalSide, modifiedSide] = await Promise.all([
    file.new_file ? { content: "", binary: false } : read(id, refs.baseSha, file.old_path),
    file.deleted_file
      ? { content: "", binary: false }
      : read(headProject, refs.headSha, file.new_path),
  ]);
  if (!originalSide || !modifiedSide)
    return { path, original: "", modified: "", ...base, binary: false, tooLarge: true };
  if (originalSide.binary || modifiedSide.binary)
    return { path, original: "", modified: "", ...base, binary: true, tooLarge: false };
  return {
    path,
    original: originalSide.content,
    modified: modifiedSide.content,
    ...base,
    binary: false,
    tooLarge: false,
  };
}
