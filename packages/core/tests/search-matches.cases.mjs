import { expect, test } from "vite-plus/test";
import { searchMatches } from "../modules/workspace/index.ts";

test("searchMatches finds a pasted snippet across lines", () => {
  expect(searchMatches("alpha\nbeta\ngamma\n", "alpha\nbeta")).toStrictEqual([
    { start: 0, end: 10 },
  ]);
});

test("a multiline regex uses the dotall flag", () => {
  expect(searchMatches("alpha\nbeta", "a.*\nb", { regex: true })).toStrictEqual([
    { start: 0, end: 7 },
  ]);
});
