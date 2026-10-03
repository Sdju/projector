import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutGraph } from "../core/modules/workspace/index.ts";

const commit = (hash, ...parents) => ({ hash, parents });

test("a linear history stays in one column", () => {
  const rows = layoutGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
  assert.deepEqual(
    rows.map((row) => [row.column, row.joins, row.forks, row.through, row.width]),
    [
      [0, [], [0], [], 1],
      [0, [0], [0], [], 1],
      [0, [0], [], [], 1],
    ],
  );
});

test("a merge forks into a second lane that rejoins at the common ancestor", () => {
  // m merges b (side) into a-line; both descend from base.
  const rows = layoutGraph([
    commit("m", "a", "b"),
    commit("a", "base"),
    commit("b", "base"),
    commit("base"),
  ]);
  assert.deepEqual(rows[0], { column: 0, through: [], joins: [], forks: [0, 1], width: 2 });
  assert.deepEqual(rows[1], { column: 0, through: [1], joins: [0], forks: [0], width: 2 });
  assert.deepEqual(rows[2], { column: 1, through: [0], joins: [1], forks: [0], width: 2 });
  assert.deepEqual(rows[3], { column: 0, through: [], joins: [0], forks: [], width: 1 });
});

test("independent tips take separate columns and a freed lane is reused", () => {
  const rows = layoutGraph([commit("x", "p"), commit("y", "q"), commit("p"), commit("z")]);
  assert.equal(rows[0].column, 0);
  assert.equal(rows[1].column, 1);
  assert.deepEqual(rows[1].through, [0]);
  assert.equal(rows[2].column, 0);
  // Lane 0 ended at p, so the next unrelated tip takes it again.
  assert.equal(rows[3].column, 0);
  assert.deepEqual(rows[3].through, [1]);
});

test("parents outside the loaded page keep their lane", () => {
  const rows = layoutGraph([commit("b", "missing"), commit("a", "gone")]);
  assert.equal(rows[1].column, 1);
  assert.deepEqual(rows[1].through, [0]);
});
