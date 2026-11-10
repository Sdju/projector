import type { FileChange, FileChangeKind } from "@ai-projector/core/modules/workspace/index.ts";

export const CHANGE_MARK: Record<FileChangeKind, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  conflict: "U",
};

export interface ChangeDirNode {
  name: string;
  path: string;
  directories: ChangeDirNode[];
  files: FileChange[];
}

export interface ChangeTreeRow {
  kind: "directory" | "file";
  name: string;
  path: string;
  depth: number;
  files?: number;
  additions?: number;
  deletions?: number;
  file?: FileChange;
}

/** Builds the directory tree of a flat changed-file list. */
export function buildChangeTree(files: FileChange[]): ChangeDirNode {
  const root: ChangeDirNode = { name: "", path: "", directories: [], files: [] };
  const directories = new Map<string, ChangeDirNode>([["", root]]);
  const bucket = (path: string) => {
    if (directories.has(path)) return directories.get(path)!;
    const parts = path.split("/");
    let parent = root;
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      let node = directories.get(current);
      if (!node) {
        node = { name: part, path: current, directories: [], files: [] };
        directories.set(current, node);
        parent.directories.push(node);
      }
      parent = node;
    }
    return parent;
  };
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    bucket(slash < 0 ? "" : file.path.slice(0, slash)).files.push(file);
  }
  return root;
}

/** GitLab collapses single-child directory chains; the root keeps its own first row. */
export function foldChangeDirectory(node: ChangeDirNode, rootLevel: boolean) {
  let name = node.name;
  let path = node.path;
  let target = node;
  if (!rootLevel) {
    while (target.directories.length === 1 && target.files.length === 0) {
      const child = target.directories[0]!;
      name = name ? `${name}/${child.name}` : child.name;
      path = child.path;
      target = child;
    }
  }
  return { name, path, node: target };
}

export function changeDirectoryStats(directory: ChangeDirNode) {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  const walk = (node: ChangeDirNode) => {
    for (const file of node.files) {
      files++;
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }
    for (const child of node.directories) walk(child);
  };
  walk(directory);
  return { files, additions, deletions };
}

function fileRow(file: FileChange, depth: number): ChangeTreeRow {
  const name = file.path.split("/").pop() || file.path;
  return { kind: "file", name, path: file.path, depth, file };
}

export function flattenChangeTree(
  node: ChangeDirNode,
  depth: number,
  rootLevel: boolean,
  allExpanded: boolean,
  expanded: Set<string>,
): ChangeTreeRow[] {
  const rows: ChangeTreeRow[] = [];
  const directories = [...node.directories].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
  for (const directory of directories) {
    const folded = foldChangeDirectory(directory, rootLevel);
    const stats = changeDirectoryStats(folded.node);
    rows.push({ kind: "directory", name: folded.name, path: folded.path, depth, ...stats });
    if (allExpanded || expanded.has(folded.path))
      rows.push(...flattenChangeTree(folded.node, depth + 1, false, allExpanded, expanded));
  }
  const files = [...node.files].sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: "base" }),
  );
  for (const file of files) rows.push(fileRow(file, depth));
  return rows;
}

/** Paths of every directory row, used to expand or collapse the whole tree. */
export function changeDirectoryPaths(files: FileChange[]): Set<string> {
  const next = new Set<string>();
  const walk = (node: ChangeDirNode, rootLevel: boolean) => {
    for (const directory of node.directories) {
      const folded = foldChangeDirectory(directory, rootLevel);
      next.add(folded.path);
      walk(folded.node, false);
    }
  };
  walk(buildChangeTree(files), true);
  return next;
}
