import type { GitChange } from "./contract.ts";
export type GitDecoration = "added" | "modified" | "deleted" | "conflict";
export function gitTreeDecorations(changes: GitChange[]): Map<string, GitDecoration> {
  const result = new Map<string, GitDecoration>();
  const merge = (path: string, kind: GitDecoration) => {
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
  const add = (path: string, kind: GitDecoration) => {
    if (!path) return;
    const parts = path.replace(/\/$/, "").split("/");
    for (let depth = 1; depth <= parts.length; depth++)
      merge(parts.slice(0, depth).join("/"), kind);
  };
  for (const change of changes) {
    const status = change.index + change.worktree;
    if (status === "  " || status === "!!") continue;
    const kind: GitDecoration =
      status.includes("U") || status === "AA" || status === "DD"
        ? "conflict"
        : status.includes("?") || status.includes("A")
          ? "added"
          : status.includes("D")
            ? "deleted"
            : "modified";
    add(change.path, kind);
    // A rename also changes the original directory, even though the old row is gone.
    if (change.originalPath && status.includes("R")) add(change.originalPath, "deleted");
  }
  return result;
}
