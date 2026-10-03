import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHANGES_MIN,
  HISTORY_COLLAPSE,
  HISTORY_MIN,
  resizeHistory,
} from "../src/modules/workspace/lib/git-split.ts";

test("dragging up grows the history and dragging down shrinks it", () => {
  assert.deepEqual(resizeHistory(200, 600, -50), { height: 250 });
  assert.deepEqual(resizeHistory(200, 600, 50), { height: 150 });
});

test("history keeps the minimum height until it is squeezed past the collapse threshold", () => {
  assert.deepEqual(resizeHistory(200, 600, 200 - HISTORY_COLLAPSE - 4), { height: HISTORY_MIN });
  assert.deepEqual(resizeHistory(200, 600, 200), { height: 200, collapse: true });
});

test("the changes zone always keeps its minimum", () => {
  assert.deepEqual(resizeHistory(200, 600, -1000), { height: 600 - CHANGES_MIN });
  // A tiny panel never forces the history below its own minimum.
  assert.deepEqual(resizeHistory(130, 150, -100), { height: HISTORY_MIN });
});
