import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { defaultFilesExclude } from "../../core/modules/workspace/index.ts";
import { findProjectPaths, withFilesExclude } from "../modules/workspace/index.ts";

async function project() {
  const root = await mkdtemp(join(tmpdir(), "projector-find-paths-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src", "deep"), { recursive: true });
  await writeFile(join(root, "README.md"), "intro\n");
  await writeFile(join(root, "src", "search.ts"), "export const search = 1;\n");
  await writeFile(join(root, "src", "deep", "util.ts"), "export const util = 1;\n");
  return root;
}

test("path search ranks a file name above a hit in the folders", async () => {
  await withFilesExclude(defaultFilesExclude(), async () => {
    const root = await project();
    expect((await findProjectPaths(root, "search")).map((item) => item.path)).toStrictEqual([
      "src/search.ts",
    ]);
    expect((await findProjectPaths(root, "readme")).map((item) => item.path)).toStrictEqual([
      "README.md",
    ]);
    const top = await findProjectPaths(root, "");
    expect(top.some((item) => item.path === "src" && item.directory)).toBeTruthy();
    expect(top.some((item) => item.path === "README.md" && !item.directory)).toBeTruthy();
  });
});

test("a committed tree ignores files added after the commit", async () => {
  await withFilesExclude(defaultFilesExclude(), async () => {
    const root = await project();
    const run = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
    run("init", "-q", "-b", "main");
    run("config", "user.name", "Search Test");
    run("config", "user.email", "search@example.test");
    run("add", ".");
    run("commit", "-qm", "initial");
    const hash = run("rev-parse", "HEAD").trim();
    await writeFile(join(root, "src", "later.ts"), "export const later = 1;\n");
    expect((await findProjectPaths(root, "later")).map((item) => item.path)).toStrictEqual([
      "src/later.ts",
    ]);
    expect(
      (await findProjectPaths(root, "later", 30, hash)).map((item) => item.path),
    ).toStrictEqual([]);
    expect(
      (await findProjectPaths(root, "search", 30, hash)).map((item) => item.path),
    ).toStrictEqual(["src/search.ts"]);
  });
});

test("path search from a subfolder stays relative to that project", async () => {
  await withFilesExclude(defaultFilesExclude(), async () => {
    const root = await project();
    const run = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
    run("init", "-q", "-b", "main");
    run("config", "user.name", "Search Test");
    run("config", "user.email", "search@example.test");
    run("add", ".");
    run("commit", "-qm", "initial");
    const hash = run("rev-parse", "HEAD").trim();
    const nested = join(root, "src");
    expect((await findProjectPaths(nested, "util")).map((item) => item.path)).toStrictEqual([
      "deep/util.ts",
    ]);
    expect(
      (await findProjectPaths(nested, "util", 30, hash)).map((item) => item.path),
    ).toStrictEqual(["deep/util.ts"]);
  });
});
