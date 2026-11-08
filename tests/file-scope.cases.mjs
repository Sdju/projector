import { expect, test } from "vite-plus/test";
import {
  commitFilesToFileChanges,
  fileChangeDecorations,
  fileScopeKey,
  fileScopeNote,
  fileScopeQuery,
  fileScopeTitle,
  gitChangesToFileChanges,
  pullRequestFilesToFileChanges,
} from "../packages/core/modules/workspace/index.ts";
import { fileTabKey } from "../packages/client/modules/workspace/open-file.ts";

test("a file scope is a stable serializable identity", () => {
  const live = { kind: "live" };
  expect(fileScopeKey(live)).toBe("live");
  expect(fileScopeQuery(live)).toStrictEqual({});
  expect(fileScopeTitle(live)).toBe("Файлы проекта");
  expect(fileScopeNote(live)).toBe("");

  const commit = { kind: "commit", rev: "a".repeat(40) };
  expect(fileScopeKey(commit)).toBe(`commit:${"a".repeat(40)}`);
  expect(fileScopeQuery(commit)).toStrictEqual({ rev: "a".repeat(40) });
  expect(fileScopeTitle(commit)).toBe("Файлы коммита @aaaaaaa");
  expect(fileScopeNote(commit)).toBe("Только чтение · коммит aaaaaaa");

  const compare = { kind: "compare", from: "b".repeat(40), to: "c".repeat(40) };
  expect(fileScopeKey(compare)).toBe(`compare:${"b".repeat(40)}..${"c".repeat(40)}`);
  expect(fileScopeQuery(compare)).toStrictEqual({ from: "b".repeat(40), to: "c".repeat(40) });
  expect(fileScopeTitle(compare)).toBe("Сравнение bbbbbbb..ccccccc");
  expect(fileScopeNote(compare)).toBe("Только чтение · bbbbbbb..ccccccc");
});

test("Git, commit and merge request changes share one status vocabulary", () => {
  const change = (path, index = " ", worktree = "M", originalPath) => ({
    path,
    index,
    worktree,
    ...(originalPath ? { originalPath } : {}),
  });
  expect(
    gitChangesToFileChanges([
      change("edit.ts"),
      change("new.ts", "?", "?"),
      change("deleted.ts", "D", " "),
      change("moved.ts", "R", " ", "old.ts"),
      change("conflict.ts", "U", "U"),
      change("ignored.ts", "!", "!"),
      change("clean.ts", " ", " "),
    ]),
  ).toStrictEqual([
    { path: "edit.ts", kind: "modified" },
    { path: "new.ts", kind: "added" },
    { path: "deleted.ts", kind: "deleted" },
    { path: "moved.ts", kind: "renamed", originalPath: "old.ts" },
    { path: "conflict.ts", kind: "conflict" },
  ]);

  expect(
    commitFilesToFileChanges([
      { path: "a.ts", status: "A", additions: 2, deletions: 0, binary: false },
      { path: "b.ts", status: "M", additions: 1, deletions: 1, binary: false },
      { path: "c.ts", status: "D", additions: 0, deletions: 3, binary: false },
      {
        path: "d.ts",
        status: "R",
        originalPath: "e.ts",
        additions: 0,
        deletions: 0,
        binary: false,
      },
      { path: "f.bin", status: "T", additions: 0, deletions: 0, binary: true },
    ]),
  ).toStrictEqual([
    { path: "a.ts", kind: "added", additions: 2, deletions: 0, binary: false },
    { path: "b.ts", kind: "modified", additions: 1, deletions: 1, binary: false },
    { path: "c.ts", kind: "deleted", additions: 0, deletions: 3, binary: false },
    {
      path: "d.ts",
      kind: "renamed",
      originalPath: "e.ts",
      additions: 0,
      deletions: 0,
      binary: false,
    },
    { path: "f.bin", kind: "modified", additions: 0, deletions: 0, binary: true },
  ]);

  expect(
    pullRequestFilesToFileChanges([
      {
        path: "new.ts",
        previousPath: "",
        status: "added",
        additions: 2,
        deletions: 0,
        generated: true,
      },
      {
        path: "gone.ts",
        previousPath: "",
        status: "removed",
        additions: 0,
        deletions: 4,
        tooLarge: true,
      },
      {
        path: "moved.ts",
        previousPath: "old.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
      },
      {
        path: "same.ts",
        previousPath: "",
        status: "unchanged",
        additions: 0,
        deletions: 0,
      },
    ]),
  ).toStrictEqual([
    {
      path: "new.ts",
      kind: "added",
      additions: 2,
      deletions: 0,
      generated: true,
    },
    {
      path: "gone.ts",
      kind: "deleted",
      additions: 0,
      deletions: 4,
      tooLarge: true,
    },
    {
      path: "moved.ts",
      kind: "renamed",
      originalPath: "old.ts",
      additions: 1,
      deletions: 1,
    },
  ]);
});

test("tree decorations aggregate parent folders and rename origins", () => {
  const decorations = fileChangeDecorations([
    { path: "src/deep/edit.ts", kind: "modified" },
    { path: "src/new.ts", kind: "added" },
    { path: "src-other/clean.ts", kind: "modified" },
    { path: "deleted/old.txt", kind: "deleted" },
    { path: "destination/moved.ts", kind: "renamed", originalPath: "source/moved.ts" },
    { path: "conflicts/a.txt", kind: "conflict" },
  ]);
  expect(decorations.get("src")).toBe("modified");
  expect(decorations.get("src/deep/edit.ts")).toBe("modified");
  expect(decorations.get("src/new.ts")).toBe("added");
  expect(decorations.has("src-other")).toBe(true);
  expect(decorations.get("deleted")).toBe("deleted");
  expect(decorations.get("source")).toBe("deleted");
  expect(decorations.get("destination")).toBe("modified");
  expect(decorations.get("conflicts")).toBe("conflict");
});

test("file tab keys keep live sessions stable and separate snapshots from diffs", () => {
  expect(fileTabKey("src/a.ts")).toBe("src/a.ts:file");
  expect(fileTabKey("src/a.ts", { staged: true })).toBe("src/a.ts:index");
  expect(fileTabKey("src/a.ts", { staged: false })).toBe("src/a.ts:working");
  expect(fileTabKey("src/a.ts", { external: true })).toBe("external:src/a.ts:file");
  expect(fileTabKey("src/a.ts", { scope: { kind: "live" } })).toBe("src/a.ts:file");
  expect(fileTabKey("src/a.ts", { scope: { kind: "commit", rev: "a".repeat(40) } })).toBe(
    `src/a.ts:rev:${"a".repeat(40)}`,
  );
  expect(
    fileTabKey("src/a.ts", {
      scope: { kind: "compare", from: "b".repeat(40), to: "c".repeat(40) },
    }),
  ).toBe(`src/a.ts:compare:${"b".repeat(40)}..${"c".repeat(40)}`);
});
