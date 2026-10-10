import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, symlink, lstat } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkImportNames,
  clearImportNames,
  importProjectEntries,
  uploadProjectEntry,
} from "../server/modules/workspace/index.ts";

async function scratch() {
  const base = await mkdtemp(join(tmpdir(), "projector-import-"));
  const outside = await mkdtemp(join(tmpdir(), "projector-import-src-"));
  await mkdir(join(base, "docs/sub"), { recursive: true });
  await writeFile(join(base, "docs/a.txt"), "old");
  await writeFile(join(base, "docs/a (2).txt"), "old2");
  return {
    base,
    outside,
    cleanup: () =>
      Promise.all([
        rm(base, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]),
  };
}

test("check lists taken names with a free neighbour", async () => {
  const { base, cleanup } = await scratch();
  try {
    expect(await checkImportNames(base, "docs", ["a.txt", "new.txt"])).toStrictEqual({
      conflicts: [{ name: "a.txt", free: "a (3).txt" }],
    });
    expect(await checkImportNames(base, "", ["docs", "docs"])).toStrictEqual({
      conflicts: [
        { name: "docs", free: "docs (2)" },
        { name: "docs", free: "docs (3)" },
      ],
    });
    await expect(checkImportNames(base, "docs", ["../x"])).rejects.toMatchObject({ status: 400 });
    await expect(checkImportNames(base, "../x", ["a"])).rejects.toMatchObject({ status: 403 });
    await expect(checkImportNames(base, "docs/a.txt", ["a"])).rejects.toMatchObject({
      status: 400,
    });
  } finally {
    await cleanup();
  }
});

test("copy publishes files and folders without touching the source", async () => {
  const { base, outside, cleanup } = await scratch();
  try {
    await mkdir(join(outside, "pack/inner"), { recursive: true });
    await writeFile(join(outside, "pack/inner/b.txt"), "b");
    await symlink("inner/b.txt", join(outside, "pack/link"));
    await writeFile(join(outside, "c.txt"), "c");
    await symlink(join(outside, "c.txt"), join(outside, "alias.txt"));
    const result = await importProjectEntries(base, "docs/sub", [
      { source: join(outside, "pack"), name: "pack" },
      { source: join(outside, "alias.txt"), name: "c.txt" },
    ]);
    expect(result.copied).toStrictEqual(["docs/sub/pack", "docs/sub/c.txt"]);
    expect(await readFile(join(base, "docs/sub/pack/inner/b.txt"), "utf8")).toBe("b");
    expect((await lstat(join(base, "docs/sub/pack/link"))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(base, "docs/sub/c.txt"))).isFile()).toBe(true);
    expect(await readFile(join(outside, "c.txt"), "utf8")).toBe("c");
    expect((await readdir(join(base, "docs/sub"))).sort()).toStrictEqual(["c.txt", "pack"]);
  } finally {
    await cleanup();
  }
});

test("copy refuses overwrites, bad sources and self-copies, leaving nothing behind", async () => {
  const { base, outside, cleanup } = await scratch();
  try {
    await writeFile(join(outside, "a.txt"), "new");
    await writeFile(join(outside, "ok.txt"), "ok");
    await expect(
      importProjectEntries(base, "docs", [
        { source: join(outside, "ok.txt"), name: "ok.txt" },
        { source: join(outside, "a.txt"), name: "a.txt" },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(base, "docs/a.txt"), "utf8")).toBe("old");
    expect(await readdir(join(base, "docs"))).not.toContain("ok.txt");
    await expect(
      importProjectEntries(base, "docs", [{ source: "relative.txt", name: "x" }]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      importProjectEntries(base, "docs", [{ source: join(outside, "missing"), name: "x" }]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      importProjectEntries(base, "docs", [{ source: join(outside, "ok.txt"), name: ".git" }]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      importProjectEntries(base, "docs/sub", [{ source: join(base, "docs"), name: "docs" }]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      importProjectEntries(base, "docs", [
        { source: join(outside, "ok.txt"), name: "same" },
        { source: join(outside, "a.txt"), name: "same" },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await readdir(join(base, "docs"))).filter((name) => name.endsWith(".tmp")),
    ).toStrictEqual([]);
  } finally {
    await cleanup();
  }
});

test("clear moves taken names to the trash so replacing is recoverable", async () => {
  const { base, cleanup } = await scratch();
  try {
    await clearImportNames(base, "docs", ["a.txt", "missing.txt"]);
    expect(await readdir(join(base, "docs"))).not.toContain("a.txt");
    const trash = await readdir(join(base, ".projector-trash"));
    expect(trash).toHaveLength(1);
    expect(await readFile(join(base, ".projector-trash", trash[0]), "utf8")).toBe("old");
  } finally {
    await cleanup();
  }
});

test("upload streams files, builds folders and never overwrites", async () => {
  const { base, cleanup } = await scratch();
  try {
    const body = (text) => Readable.from([Buffer.from(text)]);
    expect(
      await uploadProjectEntry(base, "docs/sub", "pack/deep/f.txt", body("hello")),
    ).toStrictEqual({
      destination: "docs/sub/pack/deep/f.txt",
    });
    expect(await readFile(join(base, "docs/sub/pack/deep/f.txt"), "utf8")).toBe("hello");
    await uploadProjectEntry(base, "docs", "empty", body(""), { directory: true });
    expect((await lstat(join(base, "docs/empty"))).isDirectory()).toBe(true);
    await expect(uploadProjectEntry(base, "docs", "a.txt", body("x"))).rejects.toMatchObject({
      status: 409,
    });
    expect(await readFile(join(base, "docs/a.txt"), "utf8")).toBe("old");
    await expect(
      uploadProjectEntry(base, "docs", "big.bin", body("123456"), { limit: 3 }),
    ).rejects.toMatchObject({ status: 413 });
    expect(await readdir(join(base, "docs"))).not.toContain("big.bin");
    expect(
      (await readdir(join(base, "docs"))).filter((name) => name.endsWith(".tmp")),
    ).toStrictEqual([]);
    for (const path of ["../x", "a//b", "/abs", ".git/config", "a\\b"])
      await expect(uploadProjectEntry(base, "docs", path, body("x"))).rejects.toMatchObject({
        status: 400,
      });
    await expect(uploadProjectEntry(base, "../x", "f", body("x"))).rejects.toMatchObject({
      status: 403,
    });
    await symlink(base, join(base, "docs/link"));
    await expect(uploadProjectEntry(base, "docs", "link/f", body("x"))).rejects.toMatchObject({
      status: 409,
    });
  } finally {
    await cleanup();
  }
});
