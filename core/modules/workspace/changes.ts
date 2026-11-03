import type { GitChange, GitCommitFile } from "./contract.ts";
import type { PullRequestFile } from "./pull-requests.ts";

/** One changed path in the vocabulary shared by Git, commits and merge requests. */
export type FileChangeKind = "added" | "modified" | "deleted" | "renamed" | "copied" | "conflict";

export interface FileChange {
  path: string;
  originalPath?: string;
  kind: FileChangeKind;
  additions?: number;
  deletions?: number;
  binary?: boolean;
  tooLarge?: boolean;
  generated?: boolean;
}

/** A tree mark: renamed and copied files are still changes of an existing row. */
export type FileDecoration = "added" | "modified" | "deleted" | "conflict";

function hasChange(status: string): boolean {
  return !!status.trim() && status !== "!!";
}

/** Two-column Git status (`MM`, `A `, `R?`, …) collapsed into one kind. */
export function gitChangeKind(change: GitChange): FileChangeKind | undefined {
  const status = change.index + change.worktree;
  if (!hasChange(status.replace(/ /g, ""))) return undefined;
  if (status.includes("U") || status === "AA" || status === "DD") return "conflict";
  if (status.includes("?") || status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("R")) return "renamed";
  if (status.includes("C")) return "copied";
  return "modified";
}

export function gitChangesToFileChanges(changes: readonly GitChange[]): FileChange[] {
  const result: FileChange[] = [];
  for (const change of changes) {
    const kind = gitChangeKind(change);
    if (!kind) continue;
    result.push({
      path: change.path,
      kind,
      ...(change.originalPath ? { originalPath: change.originalPath } : {}),
    });
  }
  return result;
}

/** Commit status letters: A, M, D, R, C, T (a type change is a modification). */
export function commitChangeKind(status: string): FileChangeKind {
  if (status === "A") return "added";
  if (status === "D") return "deleted";
  if (status === "R") return "renamed";
  if (status === "C") return "copied";
  return "modified";
}

export function commitFilesToFileChanges(files: readonly GitCommitFile[]): FileChange[] {
  return files.map((file) => ({
    path: file.path,
    kind: commitChangeKind(file.status),
    ...(file.originalPath ? { originalPath: file.originalPath } : {}),
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
  }));
}

/** Host-neutral merge request statuses, already close to the shared vocabulary. */
export function pullRequestChangeKind(
  status: PullRequestFile["status"],
): FileChangeKind | undefined {
  if (status === "unchanged") return undefined;
  if (status === "removed") return "deleted";
  if (status === "changed") return "modified";
  return status;
}

export function pullRequestFilesToFileChanges(files: readonly PullRequestFile[]): FileChange[] {
  const result: FileChange[] = [];
  for (const file of files) {
    const kind = pullRequestChangeKind(file.status);
    if (!kind) continue;
    result.push({
      path: file.path,
      kind,
      ...(file.previousPath ? { originalPath: file.previousPath } : {}),
      additions: file.additions,
      deletions: file.deletions,
      ...(file.binary ? { binary: true } : {}),
      ...(file.tooLarge ? { tooLarge: true } : {}),
      ...(file.generated ? { generated: true } : {}),
    });
  }
  return result;
}

/** Marks of a tree: a changed file also marks every parent folder. */
export function fileChangeDecorations(changes: readonly FileChange[]): Map<string, FileDecoration> {
  const result = new Map<string, FileDecoration>();
  const merge = (path: string, kind: FileDecoration) => {
    const previous = result.get(path);
    result.set(
      path,
      !previous || previous === kind
        ? kind
        : previous === "conflict" || kind === "conflict"
          ? "conflict"
          : "modified",
    );
  };
  const add = (path: string, kind: FileDecoration) => {
    if (!path) return;
    const parts = path.replace(/\/$/, "").split("/");
    for (let depth = 1; depth <= parts.length; depth++)
      merge(parts.slice(0, depth).join("/"), kind);
  };
  const decoration = (kind: FileChangeKind): FileDecoration =>
    kind === "added" || kind === "deleted" || kind === "conflict" ? kind : "modified";
  for (const change of changes) {
    add(change.path, decoration(change.kind));
    // A rename also changes the original directory, even though the old row is gone.
    if (change.kind === "renamed" && change.originalPath) add(change.originalPath, "deleted");
  }
  return result;
}
