import { normalizeGithubRepository } from "../project/index.ts";
export interface GithubRepository {
  fullName: string;
  description: string;
  branch: string;
  commit: string;
  tree: string;
  private: boolean;
  empty: boolean;
  owner: string;
  avatarUrl: string;
  htmlUrl: string;
  defaultBranch: string;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  language: string;
  license: string;
  homepage: string;
  topics: string[];
  createdAt: string;
  updatedAt: string;
}
export interface GithubEntry {
  name: string;
  sha: string;
  type: "tree" | "blob" | "commit";
  mode: string;
  size: number;
}
export interface GithubFile {
  content: string;
  image: string | null;
  binary: boolean;
  size: number;
}
export function githubProjectRoute(repository: string): string {
  const name = normalizeGithubRepository(repository);
  return `/gh/projects/${name.split("/").map(encodeURIComponent).join("/")}`;
}

const REMOTE_URL =
  /^(?:https?|git|ssh):\/\/(?:[^@/]+@)?(?:ssh\.)?github\.com(?::\d+)?\/([^/?#]+)\/([^/?#]+)/i;
const REMOTE_SCP = /^(?:[^@/]+@)?github\.com:([^/]+)\/(.+)$/i;

/**
 * `origin` remote of a local repository as `owner/repository`, or null when it does not point
 * at GitHub. Accepts HTTPS, `git://`, `ssh://` and the scp-like `git@github.com:owner/repo.git`.
 */
export function githubRepositoryFromRemote(remote: string): string | null {
  const value = remote.trim();
  const match = REMOTE_URL.exec(value) ?? REMOTE_SCP.exec(value);
  if (!match) return null;
  try {
    return normalizeGithubRepository(`${match[1]}/${match[2]}`);
  } catch {
    return null;
  }
}
