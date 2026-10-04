import type {
  GithubRepository,
  GithubEntry,
  GithubFile,
} from "../../../core/modules/github/index.ts";
export async function readGit<T>(
  action: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `/api/integrations/github/browse/${action}?${new URLSearchParams(params)}`,
    { signal },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Не удалось прочитать GitHub");
  return data;
}
export const readRepository = (repository: string, ref = "", signal?: AbortSignal) =>
  readGit<GithubRepository>("repository", { repository, ref }, signal);
export const readTree = (repository: string, sha: string, signal?: AbortSignal) =>
  readGit<{ entries: GithubEntry[]; truncated: boolean }>("tree", { repository, sha }, signal);
export const readFile = (repository: string, sha: string, path: string, signal?: AbortSignal) =>
  readGit<GithubFile>("file", { repository, sha, path }, signal);
