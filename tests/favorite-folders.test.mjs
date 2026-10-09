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
const { searchLauncher, launchItem, launchDetail } =
  await import("../server/modules/launcher/index.ts");
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

  // The folder opens the empty list and is a section of its own.
  const browse = await searchLauncher("");
  expect(browse.items[0]).toMatchObject({
    id: `dir:${work}`,
    section: "folders",
    kind: "directory",
  });
  expect((await launchDetail(`dir:${work}`)).actions.map((a) => a.id)).toEqual(["open", "folder"]);

  // "folder/name" offers to create a project there.
  const offer = (await searchLauncher("wor/gamma")).items[0];
  expect(offer).toMatchObject({ id: `new:${join(work, "gamma")}`, actions: [{ id: "create" }] });
  expect((await searchLauncher("wor/.hidden")).items.some((i) => i.id.startsWith("new:"))).toBe(
    false,
  );

  const created = await launchItem(offer.id, "create", true);
  expect(created.route).toContain("gamma");
  expect((await stat(join(work, "gamma"))).isDirectory()).toBe(true);
  // Never overwrites, and refuses folders that are not favorites.
  await expect(launchItem(offer.id, "create", true)).rejects.toThrow("уже существует");
  await expect(launchItem(`new:${join(root, "other")}`, "create", true)).rejects.toThrow(
    "избранных",
  );

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
