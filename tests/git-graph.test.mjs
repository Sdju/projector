import { expect, test } from "vite-plus/test";
import { layoutGraph } from "../core/modules/workspace/index.ts";

const commit = (hash, ...parents) => ({ hash, parents });

test("a linear history stays in one column", () => {
  const rows = layoutGraph([commit("c", "b"), commit("b", "a"), commit("a")]);
  expect(
    rows.map((row) => [row.column, row.joins, row.forks, row.through, row.width]),
  ).toStrictEqual([
    [0, [], [0], [], 1],
    [0, [0], [0], [], 1],
    [0, [0], [], [], 1],
  ]);
});

test("a merge forks into a second lane that rejoins at the common ancestor", () => {
  // m merges b (side) into a-line; both descend from base.
  const rows = layoutGraph([
    commit("m", "a", "b"),
    commit("a", "base"),
    commit("b", "base"),
    commit("base"),
  ]);
  expect(rows[0]).toStrictEqual({ column: 0, through: [], joins: [], forks: [0, 1], width: 2 });
  expect(rows[1]).toStrictEqual({ column: 0, through: [1], joins: [0], forks: [0], width: 2 });
  expect(rows[2]).toStrictEqual({ column: 1, through: [0], joins: [1], forks: [0], width: 2 });
  expect(rows[3]).toStrictEqual({ column: 0, through: [], joins: [0], forks: [], width: 1 });
});

test("independent tips take separate columns and a freed lane is reused", () => {
  const rows = layoutGraph([commit("x", "p"), commit("y", "q"), commit("p"), commit("z")]);
  expect(rows[0].column).toBe(0);
  expect(rows[1].column).toBe(1);
  expect(rows[1].through).toStrictEqual([0]);
  expect(rows[2].column).toBe(0);
  // Lane 0 ended at p, so the next unrelated tip takes it again.
  expect(rows[3].column).toBe(0);
  expect(rows[3].through).toStrictEqual([1]);
});

test("parents outside the loaded page keep their lane", () => {
  const rows = layoutGraph([commit("b", "missing"), commit("a", "gone")]);
  expect(rows[1].column).toBe(1);
  expect(rows[1].through).toStrictEqual([0]);
});
