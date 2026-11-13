import { expect, onTestFinished, test } from "vite-plus/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApi } from "../app/api.ts";
import { pluginAssetPath } from "@ai-projector/core/modules/plugins/index.ts";
import { installPlugin } from "../modules/plugins/index.ts";

test("browser-only plugin assets require trust, current bytes and enabled state", async () => {
  const isolatedData = await mkdtemp(join(tmpdir(), "projector-browser-plugin-data-"));
  const previousData = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = isolatedData;
  onTestFinished(async () => {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    await rm(isolatedData, { recursive: true, force: true });
  });
  const source = await mkdtemp(join(tmpdir(), "projector-browser-artifact-"));
  onTestFinished(() => rm(source, { recursive: true, force: true }));
  const id = "@projector-tests/browser-assets";
  await mkdir(join(source, "dist"));
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      name: id,
      version: "1.0.0",
      type: "module",
      projector: {
        apiVersion: 1,
        browser: "dist/browser.js",
        contributes: {
          tabs: [{ id: "sample", title: "Sample plugin tab" }],
        },
      },
    }),
  );
  const entry = "export default {apiVersion:1,activate(){}};";
  await writeFile(join(source, "dist/browser.js"), entry);
  await writeFile(join(source, "dist/chunk.js"), "export const label = 'chunk';");
  await writeFile(join(source, "dist/private.html"), "<script>alert('no')</script>");
  await writeFile(join(source, "outside.js"), "secret outside artifact directory");
  const installed = (await installPlugin(source)).plugins.find((plugin) => plugin.id === id);
  expect(installed).toMatchObject({ enabled: false, trusted: false, requiresTrust: true });
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const action = async (action) => {
    const response = await fetch(`${origin}/api/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ action, id }),
    });
    return { status: response.status, body: await response.json() };
  };
  const url = (hash, path = "browser.js") => `${origin}${pluginAssetPath(id, hash, path)}`;
  expect((await fetch(url(installed.hash))).status).toBe(404);
  expect((await action("enable")).status).toBe(400);
  expect((await action("trust")).status).toBe(200);
  const enabled = await action("enable");
  expect(enabled.status).toBe(200);
  const plugin = enabled.body.plugins.find((plugin) => plugin.id === id);
  expect(plugin).toMatchObject({ enabled: true, trusted: true, status: "enabled" });
  const response = await fetch(url(plugin.hash));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/javascript");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await response.text()).toBe(entry);
  const head = await fetch(url(plugin.hash), { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("Content-Length")).toBe(String(Buffer.byteLength(entry)));
  expect(await head.text()).toBe("");
  expect((await fetch(url(plugin.hash, "chunk.js"))).status).toBe(200);
  expect((await fetch(url(plugin.hash, "private.html"))).status).toBe(404);
  expect((await fetch(url(plugin.hash, "outside.js"))).status).toBe(404);
  expect((await fetch(url("0".repeat(64)))).status).toBe(404);
  const traversal = url(plugin.hash).replace("browser.js", "%2e%2e%2foutside.js");
  expect((await fetch(traversal)).status).toBe(404);
  expect(
    (await fetch(url(plugin.hash), { headers: { Origin: "https://untrusted.example" } })).status,
  ).toBe(403);
  expect((await action("disable")).status).toBe(200);
  expect((await fetch(url(plugin.hash))).status).toBe(404);
  expect((await action("enable")).status).toBe(200);
  await writeFile(join(plugin.path, "dist/chunk.js"), "export const label = 'changed';");
  expect((await fetch(url(plugin.hash))).status).toBe(404);
  const catalog = await fetch(`${origin}/api/plugins`).then((response) => response.json());
  expect(catalog.plugins.find((item) => item.id === id)).toMatchObject({
    trusted: false,
    status: "error",
  });
  expect(await readFile(join(plugin.path, "dist/browser.js"), "utf8")).toBe(entry);
  expect((await action("remove")).status).toBe(200);
  expect((await fetch(url(plugin.hash))).status).toBe(404);
});
