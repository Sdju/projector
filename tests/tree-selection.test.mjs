import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectTreeRange,
  topLevelTreePaths,
  createTreeSelection,
} from "../src/modules/workspace/modules/tree/lib/tree-selection.ts";

const visible = ["a", "folder", "folder/b", "folder/c", "z"];
test("plain clicks replace, Ctrl/Meta toggle files and directories", () => {
  let state = selectTreeRange(new Set(["z"]), "z", "a", visible);
  assert.deepEqual([...state.paths], ["a"]);
  state = selectTreeRange(state.paths, state.anchor, "folder", visible, { ctrlKey: true });
  assert.deepEqual([...state.paths], ["a", "folder"]);
  state = selectTreeRange(state.paths, state.anchor, "a", visible, { metaKey: true });
  assert.deepEqual([...state.paths], ["folder"]);
  assert.equal(state.anchor, "a");
});
test("Shift crosses recursive rows in both directions and keeps its anchor", () => {
  const forward = selectTreeRange(new Set(["a"]), "a", "folder/c", visible, { shiftKey: true });
  assert.deepEqual([...forward.paths], visible.slice(0, 4));
  const shrink = selectTreeRange(forward.paths, forward.anchor, "folder", visible, {
    shiftKey: true,
  });
  assert.deepEqual([...shrink.paths], ["a", "folder"]);
  const backward = selectTreeRange(new Set(["z"]), "z", "folder/b", visible, { shiftKey: true });
  assert.deepEqual([...backward.paths], visible.slice(2));
});
test("Ctrl+Shift adds a range; hidden or removed anchor falls back to clicked row", () => {
  assert.deepEqual(
    [
      ...selectTreeRange(new Set(["z"]), "a", "folder", visible, { shiftKey: true, ctrlKey: true })
        .paths,
    ],
    ["z", "a", "folder"],
  );
  const state = selectTreeRange(new Set(["folder/b"]), "folder/b", "z", ["a", "folder", "z"], {
    shiftKey: true,
  });
  assert.deepEqual([...state.paths], ["z"]);
  assert.equal(state.anchor, "z");
});
test("bulk operations include descendants only once and preserve unrelated siblings", () => {
  assert.deepEqual(topLevelTreePaths(["folder/b", "folder", "folder-other/b", "z"]), [
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
  assert.deepEqual([...selection.paths.value], ["target/folder", "target/folder/b", "z"]);
  assert.equal(selection.anchor.value, "target/folder/b");
  selection.relocate("target/folder");
  assert.deepEqual([...selection.paths.value], ["z"]);
  assert.equal(selection.anchor.value, "");
  selection.replace();
  assert.equal(selection.paths.value.size, 0);
});
