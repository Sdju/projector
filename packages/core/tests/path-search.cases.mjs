import { expect, test } from "vite-plus/test";
import { rankPaths } from "../modules/workspace/index.ts";

const items = [
  { path: "src/search.ts", directory: false },
  { path: "search/index.ts", directory: false },
  { path: "docs/search.md", directory: false },
  { path: "packages/client/modules/workspace/ui/SearchPanel.vue", directory: false },
  { path: "src", directory: true },
  { path: "search", directory: true },
];

test("path ranking prefers the file name over a hit in folders", () => {
  expect(rankPaths(items, "search", 10).map((item) => item.path)).toStrictEqual([
    "search",
    "src/search.ts",
    "docs/search.md",
    "packages/client/modules/workspace/ui/SearchPanel.vue",
    "search/index.ts",
  ]);
});

test("an empty query is the top-level files and folders", () => {
  expect(rankPaths(items, "  ", 10).map((item) => item.path)).toStrictEqual(["search", "src"]);
});

test("a subsequence still matches a scattered file name", () => {
  expect(rankPaths(items, "spnl", 5).map((item) => item.path)).toStrictEqual([
    "packages/client/modules/workspace/ui/SearchPanel.vue",
  ]);
});
