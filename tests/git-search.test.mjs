import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { searchProjectGit } from "../server/modules/workspace/index.ts";

async function repository() {
  const base = await mkdtemp(join(tmpdir(), "projector-git-search-"));
  onTestFinished(() => rm(base, { recursive: true, force: true }));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Search Test");
  run("config", "user.email", "search@example.test");
  await mkdir(join(base, "sub"), { recursive: true });
  await writeFile(join(base, "a.txt"), "hello world\nsecond hello\n");
  await writeFile(join(base, "sub", "b.txt"), "Hello deep\n");
  run("add", ".");
  run("commit", "-qm", "initial");
  return { base, hash: run("rev-parse", "HEAD").trim() };
}

test("search reads a committed tree case-insensitively and keeps paths relative", async () => {
  const { base, hash } = await repository();
  const result = await searchProjectGit(base, hash, "hello");
  expect(result.truncated).toBe(false);
  expect(result.hits.map((hit) => [hit.path, hit.line, hit.column])).toStrictEqual([
    ["a.txt", 1, 1],
    ["a.txt", 2, 8],
    ["sub/b.txt", 1, 1],
  ]);
  expect(result.hits[0].matches).toStrictEqual([{ start: 0, end: 5 }]);

  const sensitive = await searchProjectGit(base, hash, "hello", { caseSensitive: true });
  expect(sensitive.hits.map((hit) => hit.path)).toStrictEqual(["a.txt", "a.txt"]);

  const regex = await searchProjectGit(base, hash, "h.llo", {
    caseSensitive: true,
    regex: true,
  });
  expect(regex.hits.map((hit) => hit.path)).toStrictEqual(["a.txt", "a.txt"]);

  expect(await searchProjectGit(base, hash, "missing")).toStrictEqual({
    hits: [],
    truncated: false,
  });
  await expect(searchProjectGit(base, "not-a-hash", "hello")).rejects.toMatchObject({
    status: 400,
  });
});

test("search from a subfolder returns paths of that project", async () => {
  const { base, hash } = await repository();
  const result = await searchProjectGit(join(base, "sub"), hash, "hello");
  expect(result.hits.map((hit) => hit.path)).toStrictEqual(["b.txt"]);
});
