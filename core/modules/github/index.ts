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
