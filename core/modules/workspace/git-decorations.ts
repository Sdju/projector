import type { GitChange } from "./contract.ts";
import { fileChangeDecorations, gitChangesToFileChanges, type FileDecoration } from "./changes.ts";

/** Kept as an alias: tree marks predate the shared change vocabulary. */
export type GitDecoration = FileDecoration;

export function gitTreeDecorations(changes: GitChange[]): Map<string, GitDecoration> {
  return fileChangeDecorations(gitChangesToFileChanges(changes));
}
