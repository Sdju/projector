import { expect, test } from "vite-plus/test";
import {
  CHANGE_MARK,
  buildChangeTree,
  changeDirectoryPaths,
  flattenChangeTree,
  foldChangeDirectory,
} from "../modules/workspace/modules/issues/lib/change-tree.ts";

const file = (path, kind = "modified", additions = 1, deletions = 0) => ({
  path,
  kind,
  additions,
  deletions,
});

test("builds directories, folds single-child chains and keeps root order", () => {
  const root = buildChangeTree([
    file("README.md", "added", 3, 0),
    file("src/components/ui/Button.vue", "modified", 4, 2),
    file("src/main.ts", "modified", 1, 1),
  ]);
  const collapsed = flattenChangeTree(root, 0, true, false, new Set());
  expect(collapsed.map((row) => `${row.kind}:${row.path}`)).toStrictEqual([
    "directory:src",
    "file:README.md",
  ]);
  const expanded = flattenChangeTree(root, 0, true, false, new Set(["src"]));
  expect(expanded.map((row) => `${row.kind}:${row.path}`)).toStrictEqual([
    "directory:src",
    "directory:src/components/ui",
    "file:src/main.ts",
    "file:README.md",
  ]);
  const stats = collapsed.find((row) => row.path === "src");
  expect(stats).toMatchObject({ files: 2, additions: 5, deletions: 3 });
});

test("directory paths and fold helper match the rendered tree", () => {
  const root = buildChangeTree([file("a/b/c.txt"), file("a/b/e.txt")]);
  expect(changeDirectoryPaths([file("a/b/c.txt"), file("a/b/e.txt")])).toStrictEqual(
    new Set(["a", "a/b"]),
  );
  const folded = foldChangeDirectory(root.directories[0], false);
  expect(folded.path).toBe("a/b");
});

test("change markers cover every kind", () => {
  expect(CHANGE_MARK).toMatchObject({
    added: "A",
    deleted: "D",
    modified: "M",
    renamed: "R",
    copied: "C",
    conflict: "U",
  });
});
