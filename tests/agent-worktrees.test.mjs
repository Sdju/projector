import { expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await realpath(await mkdtemp(join(tmpdir(), "projector-worktrees-")));
process.env.XDG_DATA_HOME = join(root, "data");
await mkdir(process.env.XDG_DATA_HOME, { recursive: true });
const { createWorktree, mergeWorktree, removeWorktree, worktreeCwd, worktreeStatus } =
  await import("../server/modules/agent/worktrees.ts");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function project(name) {
  const dir = join(root, name);
  await mkdir(join(dir, "app"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  // The test compares file contents byte for byte; Windows must not rewrite LF to CRLF.
  git(dir, "config", "core.autocrlf", "false");
  await writeFile(join(dir, "app", "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

test("an agent works in its own copy, which is merged into the project on request", async () => {
  const main = await project("merge");
  const folder = join(main, "app");
  const copy = await createWorktree("p1", folder);
  expect(copy.cwd.replaceAll("\\", "/").endsWith("/app")).toBe(true);
  expect(await worktreeCwd("p1", copy.id, folder)).toBe(copy.cwd);

  await writeFile(join(copy.cwd, "a.txt"), "two\n");
  await writeFile(join(copy.cwd, "new.txt"), "n\n");
  expect(await readFile(join(folder, "a.txt"), "utf8")).toBe("one\n");
  expect((await worktreeStatus("p1", copy.id, folder)).changed).toBe(2);

  const result = await mergeWorktree("p1", copy.id, folder);
  expect(result.merged).toBe(true);
  expect(await readFile(join(folder, "a.txt"), "utf8")).toBe("two\n");
  expect(await readFile(join(folder, "new.txt"), "utf8")).toBe("n\n");
  expect(existsSync(copy.cwd)).toBe(false);
  expect(git(main, "branch", "--list", copy.branch)).toBe("");
});

test("a copy can be thrown away and its identifier is checked", async () => {
  const main = await project("discard");
  const folder = join(main, "app");
  const copy = await createWorktree("p2", folder);
  await writeFile(join(copy.cwd, "a.txt"), "lost\n");
  await removeWorktree("p2", copy.id, folder);
  expect(existsSync(copy.cwd)).toBe(false);
  expect(await readFile(join(folder, "a.txt"), "utf8")).toBe("one\n");
  await expect(worktreeCwd("p2", copy.id, folder)).rejects.toThrow("удалена");
  await expect(worktreeCwd("p2", "../../etc", folder)).rejects.toThrow("Некорректная");
});

test("a conflicting merge is undone and the project stays as it was", async () => {
  const main = await project("conflict");
  const folder = join(main, "app");
  const copy = await createWorktree("p3", folder);
  await writeFile(join(copy.cwd, "a.txt"), "from agent\n");
  await writeFile(join(folder, "a.txt"), "from user\n");
  git(main, "commit", "-qam", "user change");
  await expect(mergeWorktree("p3", copy.id, folder)).rejects.toThrow("проект не изменён");
  expect(await readFile(join(folder, "a.txt"), "utf8")).toBe("from user\n");
  expect(git(main, "status", "--porcelain")).toBe("");
});

test("a folder outside git cannot be isolated", async () => {
  const plain = join(root, "plain");
  await mkdir(plain);
  await expect(createWorktree("p4", plain)).rejects.toThrow("git-проекте");
  await rm(plain, { recursive: true, force: true });
});
