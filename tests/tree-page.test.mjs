import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { treePageRange } from "../core/modules/workspace/index.ts";
import { listProjectDirectory } from "../server/modules/workspace/index.ts";

const entries = Array.from({ length: 1105 }, (_, i) => ({
  name: `file-${String(i).padStart(4, "0")}`,
}));
test("directory pages reach beyond 1000 and reveal only enough complete portions", () => {
  assert.deepEqual(treePageRange(entries, "", { limit: "30" }), {
    offset: 0,
    end: 30,
    total: 1105,
    nextOffset: 30,
  });
  assert.deepEqual(treePageRange(entries, "", { offset: "1080", limit: "30" }), {
    offset: 1080,
    end: 1105,
    total: 1105,
    nextOffset: null,
  });
  assert.equal(treePageRange(entries, "src", { limit: "30", reveal: "src/file-1030" }).end, 1050);
  assert.equal(treePageRange(entries, "src", { limit: "30", reveal: "other/file-1030" }).end, 30);
  assert.equal(treePageRange(entries, "", { offset: "99999", limit: "30" }).nextOffset, null);
  for (const params of [
    { offset: "-1" },
    { offset: "1.5" },
    { limit: "0" },
    { limit: "1001" },
    { limit: "abc" },
  ])
    assert.throws(() => treePageRange(entries, "", params), /Неверный параметр/);
});
test("local directory paging sorts globally, preserves filters and serves every file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "projector-tree-page-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (let offset = 0; offset < entries.length; offset += 30)
    await Promise.all(entries.slice(offset, offset + 30).map((entry) => writeFile(join(root, entry.name), "")));
  await mkdir(join(root, "z-folder"));
  await mkdir(join(root, "node_modules"));
  const first = await listProjectDirectory(root, "", { limit: "30" });
  assert.equal(first.entries.length, 30);
  assert.equal(first.entries[0].name, "z-folder");
  assert.equal(first.total, 1106);
  const paths = [];
  let offset = 0;
  do {
    const page = await listProjectDirectory(root, "", { offset: String(offset), limit: "30" });
    paths.push(...page.entries.map((entry) => entry.path));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(paths.length, 1106);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(paths.at(-1), "file-1104");
  await assert.rejects(
    listProjectDirectory(root, "", { limit: "1001" }),
    (error) => error.status === 400,
  );
});
