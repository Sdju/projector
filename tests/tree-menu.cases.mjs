import { expect, test } from "vite-plus/test";
import { treeMenuItems } from "../packages/client/modules/workspace/modules/tree/lib/tree-menu.ts";

const item = (id, options = {}) => ({ id, label: id, ...options });
const expand = { expanded: new Set(), item, allowed: () => true };

test("file tree offers reveal for files, folders and the project root", () => {
  const file = treeMenuItems({
    ...expand,
    entry: { path: "docs/note.md", name: "note.md", directory: false },
  });
  expect(file.map(({ id }) => id)).toContain("entry.reveal");
  expect(file[0].id).toBe("file.open");
  const directory = treeMenuItems({
    ...expand,
    entry: { path: "docs", name: "docs", directory: true },
  });
  expect(directory.map(({ id }) => id)).toContain("entry.reveal");
  const root = treeMenuItems(expand);
  expect(root.map(({ id }) => id)).toContain("entry.reveal");
});

test("reveal is hidden where the workspace has no file manager", () => {
  const items = treeMenuItems({
    ...expand,
    entry: { path: "note.md", name: "note.md", directory: false },
    allowed: (id) => id !== "entry.reveal",
  });
  expect(items.map(({ id }) => id)).not.toContain("entry.reveal");
});
