import { expect, test } from "vite-plus/test";
import {
  addFrontmatterEntry,
  parseFrontmatter,
  removeFrontmatterEntry,
  setFrontmatterValue,
  splitFrontmatter,
} from "../src/modules/workspace/modules/viewers/lib/frontmatter.ts";

const doc = '---\nname: demo\n# note\ndescription: "a: b"\nlong: |\n  one\n  two\n---\n# Title\n';

test("splits the block from the body and parses top-level keys", () => {
  const { frontmatter, body } = splitFrontmatter(doc);
  expect(body).toBe("# Title\n");
  expect(frontmatter.entries.map((e) => [e.key, e.value])).toEqual([
    ["name", "demo"],
    ["description", "a: b"],
    ["long", "one\ntwo"],
  ]);
  expect(splitFrontmatter("# no block\n").frontmatter).toBeUndefined();
  expect(splitFrontmatter("---\nnot closed\n").frontmatter).toBeUndefined();
});

test("editing one value rewrites only its lines", () => {
  const fm = splitFrontmatter(doc).frontmatter;
  expect(setFrontmatterValue(fm, 0, "other")).toBe(fm.raw.replace("name: demo", "name: other"));
  expect(setFrontmatterValue(fm, 1, "x: y")).toContain('description: "x: y"');
  expect(setFrontmatterValue(fm, 2, "a\nb\nc")).toContain("long: |-\n  a\n  b\n  c\n---");
  expect(setFrontmatterValue(fm, 0, "demo")).toBe(fm.raw);
  const risky = parseFrontmatter(setFrontmatterValue(fm, 0, "# not a comment"));
  expect(risky.entries[0].value).toBe("# not a comment");
});

test("removes and adds entries, keeps CRLF", () => {
  const fm = splitFrontmatter(doc).frontmatter;
  expect(removeFrontmatterEntry(fm, 2)).toBe('---\nname: demo\n# note\ndescription: "a: b"\n---\n');
  expect(addFrontmatterEntry(fm, "name")).toBeUndefined();
  expect(addFrontmatterEntry(fm, "bad key")).toBeUndefined();
  expect(addFrontmatterEntry(fm, "tags")).toContain("  two\ntags:\n---\n");
  const crlf = splitFrontmatter("---\r\na: 1\r\n---\r\nx").frontmatter;
  expect(setFrontmatterValue(crlf, 0, "2")).toBe("---\r\na: 2\r\n---\r\n");
});
