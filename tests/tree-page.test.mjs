import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treePageRange } from "../core/modules/workspace/index.ts";
import { listProjectDirectory } from "../server/modules/workspace/index.ts";

const entries = Array.from({ length: 1105 }, (_, i) => ({
  name: `file-${String(i).padStart(4, "0")}`,
}));
test("directory pages reach beyond 1000 and reveal only enough complete portions", () => {
  expect(treePageRange(entries, "", { limit: "30" })).toStrictEqual({
    offset: 0,
    end: 30,
    total: 1105,
    nextOffset: 30,
  });
  expect(treePageRange(entries, "", { offset: "1080", limit: "30" })).toStrictEqual({
    offset: 1080,
    end: 1105,
    total: 1105,
    nextOffset: null,
  });
  expect(treePageRange(entries, "src", { limit: "30", reveal: "src/file-1030" }).end).toBe(1050);
  expect(treePageRange(entries, "src", { limit: "30", reveal: "other/file-1030" }).end).toBe(30);
  expect(treePageRange(entries, "", { offset: "99999", limit: "30" }).nextOffset).toBe(null);
  for (const params of [
    { offset: "-1" },
    { offset: "1.5" },
    { limit: "0" },
    { limit: "1001" },
    { limit: "abc" },
  ])
    expect(() => treePageRange(entries, "", params)).toThrow(/Неверный параметр/);
});
test("local directory paging sorts globally, preserves filters and serves every file", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-tree-page-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  for (let offset = 0; offset < entries.length; offset += 30)
    await Promise.all(
      entries.slice(offset, offset + 30).map((entry) => writeFile(join(root, entry.name), "")),
    );
  await mkdir(join(root, "z-folder"));
  await mkdir(join(root, "node_modules"));
  const first = await listProjectDirectory(root, "", { limit: "30" });
  expect(first.entries.length).toBe(30);
  expect(first.entries[0].name).toBe("z-folder");
  expect(first.total).toBe(1106);
  const paths = [];
  let offset = 0;
  do {
    const page = await listProjectDirectory(root, "", { offset: String(offset), limit: "30" });
    paths.push(...page.entries.map((entry) => entry.path));
    offset = page.nextOffset;
  } while (offset !== null);
  expect(paths.length).toBe(1106);
  expect(new Set(paths).size).toBe(paths.length);
  expect(paths.at(-1)).toBe("file-1104");
  await expect(listProjectDirectory(root, "", { limit: "1001" })).rejects.toSatisfy(
    (error) => error.status === 400,
  );
});
