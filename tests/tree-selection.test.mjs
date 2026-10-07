import { expect, test } from "vite-plus/test";
import {
  selectTreeRange,
  topLevelTreePaths,
  createTreeSelection,
} from "../src/modules/workspace/modules/tree/lib/tree-selection.ts";

const visible = ["a", "folder", "folder/b", "folder/c", "z"];
test("plain clicks replace, Ctrl/Meta toggle files and directories", () => {
  let state = selectTreeRange(new Set(["z"]), "z", "a", visible);
  expect([...state.paths]).toStrictEqual(["a"]);
  state = selectTreeRange(state.paths, state.anchor, "folder", visible, { ctrlKey: true });
  expect([...state.paths]).toStrictEqual(["a", "folder"]);
  state = selectTreeRange(state.paths, state.anchor, "a", visible, { metaKey: true });
  expect([...state.paths]).toStrictEqual(["folder"]);
  expect(state.anchor).toBe("a");
});
test("Shift crosses recursive rows in both directions and keeps its anchor", () => {
  const forward = selectTreeRange(new Set(["a"]), "a", "folder/c", visible, { shiftKey: true });
  expect([...forward.paths]).toStrictEqual(visible.slice(0, 4));
  const shrink = selectTreeRange(forward.paths, forward.anchor, "folder", visible, {
    shiftKey: true,
  });
  expect([...shrink.paths]).toStrictEqual(["a", "folder"]);
  const backward = selectTreeRange(new Set(["z"]), "z", "folder/b", visible, { shiftKey: true });
  expect([...backward.paths]).toStrictEqual(visible.slice(2));
});
test("Ctrl+Shift adds a range; hidden or removed anchor falls back to clicked row", () => {
  expect([
    ...selectTreeRange(new Set(["z"]), "a", "folder", visible, { shiftKey: true, ctrlKey: true })
      .paths,
  ]).toStrictEqual(["z", "a", "folder"]);
  const state = selectTreeRange(new Set(["folder/b"]), "folder/b", "z", ["a", "folder", "z"], {
    shiftKey: true,
  });
  expect([...state.paths]).toStrictEqual(["z"]);
  expect(state.anchor).toBe("z");
});
test("bulk operations include descendants only once and preserve unrelated siblings", () => {
  expect(topLevelTreePaths(["folder/b", "folder", "folder-other/b", "z"])).toStrictEqual([
    "folder",
    "folder-other/b",
    "z",
  ]);
});
test("renames, moves and deletion update selection and anchor", () => {
  const selection = createTreeSelection();
  selection.paths.value = new Set(["folder", "folder/b", "z"]);
  selection.anchor.value = "folder/b";
  selection.relocate("folder", "target/folder");
  expect([...selection.paths.value]).toStrictEqual(["target/folder", "target/folder/b", "z"]);
  expect(selection.anchor.value).toBe("target/folder/b");
  selection.relocate("target/folder");
  expect([...selection.paths.value]).toStrictEqual(["z"]);
  expect(selection.anchor.value).toBe("");
  selection.replace();
  expect(selection.paths.value.size).toBe(0);
});
