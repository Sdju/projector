import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  listProjectGitTree,
  readProjectGitFile,
  readProjectGitImage,
} from "../server/modules/workspace/index.ts";

async function repository() {
  const base = await mkdtemp(join(tmpdir(), "projector-git-tree-"));
  onTestFinished(() => rm(base, { recursive: true, force: true }));
  const run = (...args) => execFileSync("git", ["-C", base, ...args], { encoding: "utf8" });
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Tree Test");
  run("config", "user.email", "tree@example.test");
  await mkdir(join(base, "sub", "src", "nested"), { recursive: true });
  await writeFile(join(base, "root.txt"), "root\n");
  await writeFile(join(base, "sub", "keep.txt"), "keep\n");
  await writeFile(join(base, "sub", "src", "one.ts"), "one\n");
  await writeFile(join(base, "sub", "src", "nested", "two.ts"), "two\n");
  run("add", ".");
  run("commit", "-qm", "initial");
  return { base, run, hash: run("rev-parse", "HEAD").trim() };
}

test("a committed tree pages folders of the project and of its subfolder", async () => {
  const { base, hash } = await repository();
  const root = await listProjectGitTree(base, hash);
  expect(root.entries.map((entry) => [entry.name, entry.path, entry.directory])).toStrictEqual([
    ["sub", "sub", true],
    ["root.txt", "root.txt", false],
  ]);

  const sub = await listProjectGitTree(join(base, "sub"), hash);
  expect(sub.entries.map((entry) => entry.name)).toStrictEqual(["src", "keep.txt"]);

  const src = await listProjectGitTree(base, hash, "sub/src", { limit: "1" });
  expect(src.entries.map((entry) => entry.name)).toStrictEqual(["nested"]);
  expect(src.total).toBe(2);
  expect(src.nextOffset).toBe(1);
  expect(src.truncated).toBe(true);

  const rest = await listProjectGitTree(base, hash, "sub/src", {
    offset: "1",
    limit: "1",
  });
  expect(rest.entries.map((entry) => entry.name)).toStrictEqual(["one.ts"]);
  expect(rest.nextOffset).toBe(null);
});

test("a committed file is read-only; binary files are reported without content", async () => {
  const { base, run, hash } = await repository();
  const text = await readProjectGitFile(base, hash, "sub/src/one.ts");
  expect(text).toStrictEqual({ path: "sub/src/one.ts", content: "one\n", readonly: true, size: 4 });

  await writeFile(join(base, "image.bin"), Buffer.from([0, 1, 2, 3]));
  run("add", ".");
  run("commit", "-qm", "binary");
  const next = run("rev-parse", "HEAD").trim();
  const binary = await readProjectGitFile(base, next, "image.bin");
  expect(binary).toMatchObject({ path: "image.bin", content: "", binary: true, readonly: true });

  await expect(readProjectGitFile(base, next, "missing.txt")).rejects.toSatisfy(
    (error) => error.status === 404,
  );
  await expect(listProjectGitTree(base, "not-a-hash")).rejects.toSatisfy(
    (error) => error.status === 400,
  );
});

test("a committed tree keeps the same files.exclude contract", async () => {
  const { base, run, hash } = await repository();
  await mkdir(join(base, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(base, "node_modules", "pkg", "index.js"), "x\n");
  run("add", "-f", ".");
  run("commit", "-qm", "dependencies");
  const next = run("rev-parse", "HEAD").trim();
  const tree = await listProjectGitTree(base, next);
  expect(tree.entries.map((entry) => entry.name)).toStrictEqual(["sub", "root.txt"]);
});

test("a committed raster image is served by URL and an SVG stays text", async () => {
  const { base, run } = await repository();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  await writeFile(join(base, "picture.png"), png);
  await writeFile(join(base, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
  run("add", ".");
  run("commit", "-qm", "images");
  const next = run("rev-parse", "HEAD").trim();
  expect(await readProjectGitFile(base, next, "picture.png")).toStrictEqual({
    path: "picture.png",
    content: "",
    image: true,
    readonly: true,
    size: png.length,
  });
  expect(await readProjectGitImage(base, next, "picture.png")).toStrictEqual({
    type: "image/png",
    content: png,
  });
  expect(await readProjectGitFile(base, next, "icon.svg")).toMatchObject({
    path: "icon.svg",
    content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    readonly: true,
  });
  await expect(readProjectGitImage(base, next, "missing.png")).rejects.toMatchObject({
    status: 404,
  });
});
