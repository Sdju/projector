import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCK_COLLAPSE,
  BLOCK_MIN,
  resizePair,
  useGitBlocks,
} from "../src/modules/workspace/lib/git-blocks.ts";

test("resizing moves height between neighbours and keeps the total", () => {
  assert.deepEqual(resizePair(200, 200, 50), { above: 250, below: 150 });
  assert.deepEqual(resizePair(200, 200, -50), { above: 150, below: 250 });
});

test("between the collapse threshold and the minimum the block stays at its minimum", () => {
  const near = resizePair(200, 200, -(200 - BLOCK_COLLAPSE - 4));
  assert.deepEqual(near, { above: BLOCK_MIN, below: 400 - BLOCK_MIN });
  const far = resizePair(200, 200, 200 - BLOCK_COLLAPSE - 4);
  assert.deepEqual(far, { above: 400 - BLOCK_MIN, below: BLOCK_MIN });
});

test("squeezing a block below the threshold collapses it instead of resizing", () => {
  assert.deepEqual(resizePair(200, 200, -200), { above: 200, below: 200, collapse: "above" });
  assert.deepEqual(resizePair(200, 200, 190), { above: 200, below: 200, collapse: "below" });
});

test("blocks pair with the next expanded block and collapse through the shared state", () => {
  const blocks = useGitBlocks(["staged", "changed", "history"], ["history"]);
  assert.equal(blocks.neighbour("staged"), "changed");
  assert.equal(blocks.neighbour("changed"), undefined);
  const start = { staged: 120, changed: 240 };
  assert.equal(blocks.resize("staged", start, 40), true);
  assert.deepEqual({ ...blocks.weights.value }, { staged: 160, changed: 200 });
  // Squeezing the lower block hides it; the upper one keeps its weight.
  assert.equal(blocks.resize("staged", { staged: 160, changed: 200 }, 190), false);
  assert.equal(blocks.collapsed.value.has("changed"), true);
  assert.equal(blocks.neighbour("staged"), undefined);
  blocks.setCollapsed("changed", false);
  blocks.setCollapsed("history", false);
  assert.equal(blocks.neighbour("changed"), "history");
  blocks.reset();
  assert.deepEqual({ ...blocks.weights.value }, {});
});
