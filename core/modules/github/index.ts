import { normalizeGithubRepository } from "../project/index.ts";
export interface GithubRepository {
  fullName: string;
  description: string;
  branch: string;
  commit: string;
  tree: string;
  private: boolean;
  empty: boolean;
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
