import { expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultFilesExclude } from "../../core/modules/workspace/index.ts";
import {
  deleteProjectTrash,
  emptyProjectTrash,
  listProjectDirectory,
  listProjectTrash,
  listProjectTrashDirectory,
  listProjectTrashSizes,
  mutateProjectEntry,
  restoreProjectTrash,
  withFilesExclude,
} from "../modules/workspace/index.ts";

async function scratch() {
  const base = await mkdtemp(join(tmpdir(), "projector-trash-"));
  return {
    base,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

test("deleted entries keep their path, kind and size in the trash listing", async () => {
  const { base, cleanup } = await scratch();
  try {
    await mkdir(join(base, "docs"), { recursive: true });
    await writeFile(join(base, "docs/a.txt"), "draft");
    await withFilesExclude(defaultFilesExclude(), async () => {
      await mutateProjectEntry(base, "delete", "docs/a.txt");
      await mutateProjectEntry(base, "delete", "docs");
      expect((await listProjectDirectory(base)).entries.map((entry) => entry.name)).toStrictEqual(
        [],
      );
      const { entries } = await listProjectTrash(base);
      expect(entries).toHaveLength(2);
      expect(entries.map((entry) => entry.path).sort()).toStrictEqual(["docs", "docs/a.txt"]);
      expect(entries.find((entry) => entry.path === "docs/a.txt")).toMatchObject({
        name: "a.txt",
        directory: false,
        size: 5,
      });
      expect(entries.find((entry) => entry.path === "docs")).toMatchObject({
        name: "docs",
        directory: true,
        size: null,
      });
      // The bookkeeping folder is not an entry and the trash itself stays hidden from the tree.
      expect((await readdir(join(base, ".projector-trash"))).includes(".projector-meta")).toBe(
        true,
      );
      expect(entries.some((entry) => entry.id === ".projector-meta")).toBe(false);
    });
  } finally {
    await cleanup();
  }
});

test("trash tree lists nested levels and recursive folder sizes", async () => {
  const { base, cleanup } = await scratch();
  try {
    await mkdir(join(base, "docs/sub"), { recursive: true });
    await writeFile(join(base, "docs/a.txt"), "1234");
    await writeFile(join(base, "docs/sub/b.txt"), "12");
    await writeFile(join(base, "docs/.env"), "x");
    await withFilesExclude(defaultFilesExclude(), async () => {
      await mutateProjectEntry(base, "delete", "docs");
      const { entries } = await listProjectTrash(base);
      const id = entries[0].id;

      const root = await listProjectTrashDirectory(base);
      expect(root.entries.map((entry) => entry.name)).toStrictEqual([id]);

      const level = await listProjectTrashDirectory(base, id);
      expect(level.entries.map((entry) => [entry.name, entry.directory, entry.size])).toStrictEqual(
        [
          ["sub", true, null],
          [".env", false, 1],
          ["a.txt", false, 4],
        ],
      );

      const sizes = await listProjectTrashSizes(base, id);
      expect(sizes.sizes).toStrictEqual([
        { key: `${id}/sub`, size: 2, files: 1, truncated: false },
        { key: `${id}/.env`, size: 1, files: 1, truncated: false },
        { key: `${id}/a.txt`, size: 4, files: 1, truncated: false },
      ]);
      const rootSizes = await listProjectTrashSizes(base);
      expect(rootSizes.sizes).toStrictEqual([{ key: id, size: 7, files: 3, truncated: false }]);

      const nested = await listProjectTrashDirectory(base, `${id}/sub`);
      expect(nested.entries.map((entry) => [entry.name, entry.size])).toStrictEqual([["b.txt", 2]]);
      await expect(listProjectTrashDirectory(base, `${id}/a.txt`)).rejects.toMatchObject({
        status: 400,
      });
      await expect(listProjectTrashSizes(base, `${id}/a.txt`)).rejects.toMatchObject({
        status: 400,
      });
      for (const path of ["../outside", `${id}/../x`, ".projector-meta"]) {
        await expect(listProjectTrashDirectory(base, path)).rejects.toMatchObject({ status: 400 });
        await expect(listProjectTrashSizes(base, path)).rejects.toMatchObject({ status: 400 });
      }
    });
  } finally {
    await cleanup();
  }
});

test("restore returns entries to their paths, renames conflicts and recreates parents", async () => {
  const { base, cleanup } = await scratch();
  try {
    await mkdir(join(base, "docs"), { recursive: true });
    await writeFile(join(base, "docs/a.txt"), "old");
    await writeFile(join(base, "docs/b.txt"), "b");
    await withFilesExclude(defaultFilesExclude(), async () => {
      await mutateProjectEntry(base, "delete", "docs/a.txt");
      await mutateProjectEntry(base, "delete", "docs/b.txt");
      const { entries } = await listProjectTrash(base);
      const a = entries.find((entry) => entry.path === "docs/a.txt");
      const b = entries.find((entry) => entry.path === "docs/b.txt");

      await writeFile(join(base, "docs/a.txt"), "new");
      const first = await restoreProjectTrash(base, [a.id]);
      expect(first.restored).toStrictEqual([{ id: a.id, path: "docs/a (2).txt" }]);
      expect(await readFile(join(base, "docs/a.txt"), "utf8")).toBe("new");
      expect(await readFile(join(base, "docs/a (2).txt"), "utf8")).toBe("old");

      await rm(join(base, "docs"), { recursive: true });
      const second = await restoreProjectTrash(base, [b.id]);
      expect(second.restored).toStrictEqual([{ id: b.id, path: "docs/b.txt" }]);
      expect(await readFile(join(base, "docs/b.txt"), "utf8")).toBe("b");
      expect(second.entries).toStrictEqual([]);
    });
  } finally {
    await cleanup();
  }
});

test("entries without metadata still list and restore by their stored name", async () => {
  const { base, cleanup } = await scratch();
  try {
    await mkdir(join(base, ".projector-trash"), { recursive: true });
    const legacy = "11111111-2222-3333-4444-555555555555-old.txt";
    await writeFile(join(base, ".projector-trash", legacy), "old");
    await withFilesExclude(defaultFilesExclude(), async () => {
      const { entries } = await listProjectTrash(base);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: legacy, path: "old.txt" });
      expect(entries[0].deletedAt).toBeTruthy();
      expect((await restoreProjectTrash(base, [entries[0].id])).restored).toStrictEqual([
        { id: legacy, path: "old.txt" },
      ]);
      expect(await readFile(join(base, "old.txt"), "utf8")).toBe("old");
    });
  } finally {
    await cleanup();
  }
});

test("purge removes selected entries and empty clears the whole folder", async () => {
  const { base, cleanup } = await scratch();
  try {
    await writeFile(join(base, "a.txt"), "a");
    await writeFile(join(base, "b.txt"), "b");
    await withFilesExclude(defaultFilesExclude(), async () => {
      await mutateProjectEntry(base, "delete", "a.txt");
      await mutateProjectEntry(base, "delete", "b.txt");
      const { entries } = await listProjectTrash(base);
      const a = entries.find((entry) => entry.path === "a.txt");
      const afterDelete = await deleteProjectTrash(base, [a.id]);
      expect(afterDelete.entries.map((entry) => entry.path)).toStrictEqual(["b.txt"]);
      const afterEmpty = await emptyProjectTrash(base);
      expect(afterEmpty.entries).toStrictEqual([]);
      expect(await readdir(base)).not.toContain(".projector-trash");
    });
  } finally {
    await cleanup();
  }
});

test("trash refuses foreign ids, escaping metadata and a symlinked folder", async () => {
  const { base, cleanup } = await scratch();
  try {
    await writeFile(join(base, "a.txt"), "a");
    await withFilesExclude(defaultFilesExclude(), async () => {
      await mutateProjectEntry(base, "delete", "a.txt");
      const { entries } = await listProjectTrash(base);
      const id = entries[0].id;
      await expect(restoreProjectTrash(base, ["../outside"])).rejects.toMatchObject({
        status: 400,
      });
      await expect(restoreProjectTrash(base, [".projector-meta"])).rejects.toMatchObject({
        status: 400,
      });
      await expect(deleteProjectTrash(base, [".git"])).rejects.toMatchObject({ status: 400 });

      // A tampered record must not lead the restore outside the project or into excluded paths.
      for (const path of ["../outside/a.txt", "/tmp/a.txt", ".git/config"]) {
        await writeFile(
          join(base, ".projector-trash/.projector-meta", `${id}.json`),
          JSON.stringify({ path, deletedAt: new Date().toISOString() }),
        );
        await expect(restoreProjectTrash(base, [id])).rejects.toMatchObject({ status: 403 });
      }

      await rm(join(base, ".projector-trash"), { recursive: true });
      await symlink(tmpdir(), join(base, ".projector-trash"));
      await expect(listProjectTrash(base)).rejects.toMatchObject({ status: 403 });
      await expect(restoreProjectTrash(base, [id])).rejects.toMatchObject({ status: 403 });
    });
  } finally {
    await cleanup();
  }
});
