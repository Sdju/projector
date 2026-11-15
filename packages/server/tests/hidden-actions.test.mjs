import { createServer } from "node:http";
import { once } from "node:events";
import { expect, onTestFinished, test } from "vite-plus/test";
import { handleApi } from "../app/api.ts";

test("hidden actions persist independently and can be restored", async () => {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/ide/hidden-actions`;
  const set = (id, hidden) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ id, hidden }),
    });
  expect(await (await fetch(url)).json()).toEqual({ hidden: [] });
  const results = await Promise.all([set("sidebar:search", true), set("toolbar:media", true)]);
  expect(results.map((response) => response.status)).toEqual([200, 200]);
  expect((await (await fetch(url)).json()).hidden.sort()).toEqual([
    "sidebar:search",
    "toolbar:media",
  ]);
  expect(await (await set("sidebar:search", false)).json()).toEqual({ hidden: ["toolbar:media"] });
  expect((await set("", true)).status).toBe(400);
  expect((await set("toolbar:media", "false")).status).toBe(400);
});

test("action order persists per panel and validates input", async () => {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/api/ide/action-order`;
  const set = (scope, ids) =>
    fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ scope, ids }),
    });
  expect((await set("sidebar", ["git", "files"])).status).toBe(200);
  expect((await set("toolbar", ["settings", "media"])).status).toBe(200);
  expect(await (await fetch(url)).json()).toEqual({
    sidebar: ["git", "files"],
    toolbar: ["settings", "media"],
  });
  expect((await set("sidebar", ["git", "git"])).status).toBe(400);
});
