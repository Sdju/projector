import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  compareProjectChanges,
  compareProjectFile,
} from "../packages/server/modules/workspace/index.ts";

async function repository() {
  const base = await mkdtemp(join(tmpdir(), "projector-git-compare-"));
  onTestFinished(() => rm(base, { recursive: true, force: true }));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Compare Test");
  run("config", "user.email", "compare@example.test");
  await mkdir(join(base, "sub"), { recursive: true });
  await writeFile(join(base, "keep.txt"), "one\n");
  await writeFile(join(base, "edit.txt"), "a\n");
  await writeFile(join(base, "gone.txt"), "x\n");
  await writeFile(join(base, "old-name.txt"), "rename\n");
  await writeFile(join(base, "sub", "nested.txt"), "nested\n");
  run("add", ".");
  run("commit", "-qm", "initial");
  const first = run("rev-parse", "HEAD").trim();

  await writeFile(join(base, "edit.txt"), "a\nb\n");
  await rm(join(base, "gone.txt"));
  await writeFile(join(base, "new.txt"), "new\n");
  run("mv", "old-name.txt", "new-name.txt");
  await writeFile(join(base, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(join(base, "sub", "nested.txt"), "nested\nmore\n");
  run("add", "-A");
  run("commit", "-qm", "second");
  const second = run("rev-parse", "HEAD").trim();
  return { base, run, first, second };
}

test("a comparison lists changed paths with statuses and line counts", async () => {
  const { base, first, second } = await repository();
  const result = await compareProjectChanges(base, first, second);
  expect(result.truncated).toBe(false);
  const byPath = Object.fromEntries(result.changes.map((change) => [change.path, change]));
  expect(byPath["edit.txt"]).toStrictEqual({
    path: "edit.txt",
    kind: "modified",
    additions: 1,
    deletions: 0,
  });
  expect(byPath["new.txt"]).toStrictEqual({
    path: "new.txt",
    kind: "added",
    additions: 1,
    deletions: 0,
  });
  expect(byPath["gone.txt"]).toStrictEqual({
    path: "gone.txt",
    kind: "deleted",
    additions: 0,
    deletions: 1,
  });
  expect(byPath["new-name.txt"]).toStrictEqual({
    path: "new-name.txt",
    kind: "renamed",
    originalPath: "old-name.txt",
    additions: 0,
    deletions: 0,
  });
  expect(byPath["sub/nested.txt"]).toMatchObject({ kind: "modified", additions: 1 });
  expect(byPath["binary.bin"]).toStrictEqual({
    path: "binary.bin",
    kind: "added",
    binary: true,
  });
  expect((await compareProjectChanges(base, first, first)).changes).toStrictEqual([]);
});

test("a compared file has two text sides, including missing and renamed sides", async () => {
  const { base, first, second } = await repository();
  expect(await compareProjectFile(base, first, second, "edit.txt")).toStrictEqual({
    path: "edit.txt",
    original: "a\n",
    modified: "a\nb\n",
  });
  expect(await compareProjectFile(base, first, second, "new.txt")).toStrictEqual({
    path: "new.txt",
    original: "",
    modified: "new\n",
  });
  expect(await compareProjectFile(base, first, second, "gone.txt")).toStrictEqual({
    path: "gone.txt",
    original: "x\n",
    modified: "",
  });
  expect(
    await compareProjectFile(base, first, second, "new-name.txt", "old-name.txt"),
  ).toStrictEqual({
    path: "new-name.txt",
    original: "rename\n",
    modified: "rename\n",
  });
  await expect(compareProjectFile(base, first, second, "binary.bin")).rejects.toMatchObject({
    status: 415,
  });
  await expect(compareProjectFile(base, first, second, "missing.txt")).rejects.toMatchObject({
    status: 404,
  });
  await expect(compareProjectChanges(base, "not-a-hash", second)).rejects.toMatchObject({
    status: 400,
  });
});

test("a comparison of a subfolder keeps paths relative to the project", async () => {
  const { base, first, second } = await repository();
  const result = await compareProjectChanges(join(base, "sub"), first, second);
  expect(result.changes.map((change) => change.path)).toStrictEqual(["nested.txt"]);
  expect(await compareProjectFile(join(base, "sub"), first, second, "nested.txt")).toStrictEqual({
    path: "nested.txt",
    original: "nested\n",
    modified: "nested\nmore\n",
  });
});
