import { mkdtemp, mkdir, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { expect, onTestFinished, test } from "vite-plus/test";

const root = await realpath(await mkdtemp(join(tmpdir(), "projector-folders-")));
const data = join(root, "data");
const work = join(root, "work");
await mkdir(join(data, "projector"), { recursive: true });
await mkdir(join(work, "alpha"), { recursive: true });
process.env.XDG_DATA_HOME = data;
const { searchLauncher, launchItem } = await import("../server/modules/launcher/index.ts");
const { handleApi } = await import("../server/app/api.ts");
const server = createServer((req, res) => void handleApi(req, res));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const request = (path, method = "GET", body) =>
  fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("favorite folders rank first and create projects", async () => {
  onTestFinished(() => server.close());
  expect(
    (await request("/api/launcher/folders", "POST", { path: join(root, "nope") })).status,
  ).toBe(400);
  const added = await (await request("/api/launcher/folders", "POST", { path: work })).json();
  expect(added.folders).toEqual([work]);

  // Folders are not launch targets: they never appear in the lists.
  expect((await searchLauncher("")).items.some((i) => i.kind === "directory")).toBe(false);
  expect((await searchLauncher("work")).items.some((i) => i.kind === "directory")).toBe(false);

  // new/<path> with one favorite folder offers a single, immediate creation.
  expect((await searchLauncher("new/")).warning).toContain("имя проекта");
  expect((await searchLauncher("new/.hidden")).items).toEqual([]);
  const offer = (await searchLauncher("new/gamma")).items;
  expect(offer).toHaveLength(1);
  expect(offer[0]).toMatchObject({ id: `new:${work}\ngamma`, actions: [{ id: "create" }] });
  const created = await launchItem(offer[0].id, "create", true);
  expect(created.route).toContain("gamma");
  expect((await stat(join(work, "gamma"))).isDirectory()).toBe(true);
  // A complex path creates the groups too; an existing folder is never overwritten.
  const nested = (await searchLauncher("new/group/delta")).items[0];
  await launchItem(nested.id, "create", true);
  expect((await stat(join(work, "group", "delta"))).isDirectory()).toBe(true);
  expect((await searchLauncher("new/gamma")).items[0].actions).toEqual([]);
  await expect(launchItem(offer[0].id, "create", true)).rejects.toThrow("уже существует");
  await expect(launchItem(`new:${join(root, "other")}\nx`, "create", true)).rejects.toThrow(
    "избранных",
  );

  // Several favorite folders: the user picks where the project goes.
  const second = join(root, "second");
  await mkdir(second);
  await request("/api/launcher/folders", "POST", { path: second });
  const choice = await searchLauncher("new/epsilon");
  expect(choice.warning).toContain("В какой папке");
  expect(choice.items.map((i) => i.id)).toEqual([`new:${work}\nepsilon`, `new:${second}\nepsilon`]);
  await launchItem(choice.items[1].id, "create", true);
  expect((await stat(join(second, "epsilon"))).isDirectory()).toBe(true);
  await request("/api/launcher/folders", "DELETE", { path: second });

  // Projects of the favorite folder go first in the project list.
  const alpha = await (
    await request("/api/projects/resolve", "POST", { path: join(work, "alpha") })
  ).json();
  const outside = join(root, "zzz");
  await mkdir(outside);
  await request("/api/projects/resolve", "POST", { path: outside });
  const listed = (await searchLauncher("")).items
    .filter((i) => i.section === "projects")
    .map((i) => i.name);
  expect(listed.indexOf("alpha")).toBeLessThan(listed.indexOf("zzz"));
  expect(alpha.project.id).toBeTruthy();

  // A project's folder becomes favorite from its card and can be removed again.
  const removed = await (await request("/api/launcher/folders", "DELETE", { path: work })).json();
  expect(removed.folders).toEqual([]);
  const id = `project:${alpha.project.id}`;
  expect((await launchItem(id, "folder", true)).favorite).toBe(true);
  await expect((await request("/api/launcher/folders")).json()).resolves.toEqual({
    folders: [work],
  });
});
