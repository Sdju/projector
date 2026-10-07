import { expect, test } from "vite-plus/test";
import {
  CHANGES_MIN,
  HISTORY_COLLAPSE,
  HISTORY_MIN,
  resizeHistory,
} from "../src/modules/workspace/modules/git/lib/git-split.ts";

test("dragging up grows the history and dragging down shrinks it", () => {
  expect(resizeHistory(200, 600, -50)).toEqual({ height: 250 });
  expect(resizeHistory(200, 600, 50)).toEqual({ height: 150 });
});

test("history keeps the minimum height until it is squeezed past the collapse threshold", () => {
  expect(resizeHistory(200, 600, 200 - HISTORY_COLLAPSE - 4)).toEqual({ height: HISTORY_MIN });
  expect(resizeHistory(200, 600, 200)).toEqual({ height: 200, collapse: true });
});

test("the changes zone always keeps its minimum", () => {
  expect(resizeHistory(200, 600, -1000)).toEqual({ height: 600 - CHANGES_MIN });
  // A tiny panel never forces the history below its own minimum.
  expect(resizeHistory(130, 150, -100)).toEqual({ height: HISTORY_MIN });
});
