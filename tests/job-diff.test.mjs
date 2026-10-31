import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobDiff } from "../server/modules/agent/jobs-diff.ts";

let folder;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "projector-job-diff-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: folder });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: folder });
  execFileSync("git", ["config", "user.name", "t"], { cwd: folder });
  await writeFile(join(folder, "a.txt"), "one\n");
  execFileSync("git", ["add", "-A"], { cwd: folder });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: folder });
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

test("collects tracked changes and new files", async () => {
  await writeFile(join(folder, "a.txt"), "two\n");
  await writeFile(join(folder, "b.txt"), "new\n");
  const diff = await jobDiff(folder, 50_000);
  expect(diff.files).toEqual(["a.txt", "b.txt"]);
  expect(diff.stat).toContain("a.txt");
  expect(diff.patch).toContain("+two");
  expect(diff.patch).toContain("b.txt");
  expect(diff.truncated).toBe(false);
  await writeFile(join(folder, "a.txt"), "one\n");
  await rm(join(folder, "b.txt"));
});

test("diffs from the job's base and skips what was already dirty", async () => {
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: folder }).toString().trim();
  await writeFile(join(folder, "user.txt"), "user work\n");
  await writeFile(join(folder, "a.txt"), "three\n");
  execFileSync("git", ["commit", "-qam", "job commit"], { cwd: folder });
  await writeFile(join(folder, "a.txt"), "four\n");
  const diff = await jobDiff(folder, 50_000, base, ["user.txt"]);
  expect(diff.files).toEqual(["a.txt"]);
  expect(diff.patch).toContain("+four");
  expect(diff.patch).not.toContain("user work");
  execFileSync("git", ["reset", "-q", "--hard", "HEAD~1"], { cwd: folder });
  await rm(join(folder, "user.txt"));
});

test("reports a missing folder instead of an empty diff", async () => {
  await expect(jobDiff(join(folder, "gone"))).rejects.toThrow(/не найдена/);
});

test("cuts a patch longer than the limit", async () => {
  const lines = Array.from({ length: 400 }, (_, index) => `line ${index}`).join("\n");
  await writeFile(join(folder, "big.txt"), `${lines}\n`);
  const diff = await jobDiff(folder, 1000);
  expect(diff.truncated).toBe(true);
  expect(diff.patch.length).toBeLessThan(1100);
  await rm(join(folder, "big.txt"));
});

test("reports nothing outside a git repository", async () => {
  const plain = await mkdtemp(join(tmpdir(), "projector-job-plain-"));
  await writeFile(join(plain, "a.txt"), "one\n");
  const diff = await jobDiff(plain);
  expect(diff.files).toEqual([]);
  expect(diff.patch).toBe("");
  await rm(plain, { recursive: true, force: true });
});
