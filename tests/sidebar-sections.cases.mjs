import { expect, test } from "vite-plus/test";
import {
  createSidebarRegistry,
  extendSidebarRegistry,
  groupSidebar,
} from "../packages/client/modules/workspace-api/index.ts";

const base = createSidebarRegistry(
  () => true,
  [
    { id: "files", title: "Файлы" },
    { id: "search", title: "Поиск" },
    { id: "git", title: "Git" },
  ],
  [{ id: "issues", title: "Issues" }],
);

test("runtime sections join the registry without changing the base", () => {
  const extra = [
    { id: "commit-tree:a", title: "Файлы @aaaaaaa", group: "git", kind: "commit-tree" },
    { id: "commit-tree:b", title: "Файлы @bbbbbbb", group: "git", kind: "commit-tree" },
  ];
  const sections = extendSidebarRegistry(base, () => extra);
  expect(sections.list().map((type) => type.id)).toStrictEqual([
    "files",
    "search",
    "git",
    "issues",
    "commit-tree:a",
    "commit-tree:b",
  ]);
  expect(sections.has("commit-tree:a")).toBe(true);
  expect(base.has("commit-tree:a")).toBe(false);
  expect(sections.get("commit-tree:b")?.title).toBe("Файлы @bbbbbbb");
});

test("grouped children follow their parent and keep their order", () => {
  const items = [
    { id: "files" },
    { id: "search" },
    { id: "git" },
    { id: "issues" },
    { id: "commit-tree:a", group: "git" },
    { id: "commit-tree:b", group: "git" },
  ];
  expect(groupSidebar(items).map((group) => group.map((item) => item.id))).toStrictEqual([
    ["files"],
    ["search"],
    ["git", "commit-tree:a", "commit-tree:b"],
    ["issues"],
  ]);

  const orphan = [{ id: "files" }, { id: "commit-tree:a", group: "missing" }];
  expect(groupSidebar(orphan).map((group) => group.map((item) => item.id))).toStrictEqual([
    ["files"],
    ["commit-tree:a"],
  ]);
});
