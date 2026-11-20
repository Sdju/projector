import { createServer } from "node:http";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished, test } from "vite-plus/test";
import { pluginPackageKey, pluginReadmePath } from "../../core/modules/plugins/index.ts";
import { handleApi } from "../app/api.ts";
import { installPlugin, setPluginEnabled } from "../modules/plugins/index.ts";

const fixture = fileURLToPath(new URL("fixtures/theme-plugin", import.meta.url));
const pluginId = "@projector-tests/sepia";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function isolatedData() {
  const directory = await mkdtemp(join(tmpdir(), "projector-plugin-readme-data-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  onTestFinished(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });
}

async function apiOrigin() {
  const server = createServer((req, res) => void handleApi(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("settings can read a package README even after the plugin is disabled", async () => {
  await isolatedData();
  const source = await mkdtemp(join(tmpdir(), "projector-plugin-readme-src-"));
  onTestFinished(() => rm(source, { recursive: true, force: true }));
  await cp(fixture, source, { recursive: true });
  await mkdir(join(source, "docs"));
  await writeFile(join(source, "README.md"), "# Hello **sepia**\n\n![shot](docs/shot.png)\n");
  await writeFile(join(source, "docs/shot.png"), png);
  await writeFile(join(source, "secret.svg"), "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  const catalog = await installPlugin(source);
  expect(catalog.plugins.find((item) => item.id === pluginId)).toMatchObject({ readme: true });

  const origin = await apiOrigin();
  const markdownUrl = `${origin}${pluginReadmePath(pluginId)}`;
  const response = await fetch(markdownUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/markdown");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).toContain("# Hello **sepia**");
  const head = await fetch(markdownUrl, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");

  await setPluginEnabled(pluginId, false);
  expect((await fetch(markdownUrl)).status).toBe(200);

  const image = await fetch(`${origin}${pluginReadmePath(pluginId, "docs/shot.png")}`);
  expect(image.status).toBe(200);
  expect(image.headers.get("Content-Type")).toBe("image/png");
  expect(Buffer.from(await image.arrayBuffer())).toEqual(png);

  expect((await fetch(`${origin}${pluginReadmePath(pluginId, "secret.svg")}`)).status).toBe(404);
  expect(
    (await fetch(`${origin}/api/plugins/${pluginPackageKey(pluginId)}/readme/../package.json`))
      .status,
  ).toBe(404);
  expect((await fetch(`${origin}${pluginReadmePath("missing.plugin")}`)).status).toBe(404);
  expect((await fetch(markdownUrl, { method: "POST" })).status).toBe(405);
});

test(
  "README images refuse a symlink anywhere on the path",
  { skip: process.platform === "win32" },
  async () => {
    await isolatedData();
    const source = await mkdtemp(join(tmpdir(), "projector-plugin-readme-link-src-"));
    onTestFinished(() => rm(source, { recursive: true, force: true }));
    await cp(fixture, source, { recursive: true });
    await writeFile(join(source, "README.md"), "docs\n");
    const installed = await installPlugin(source);
    const plugin = installed.plugins.find((item) => item.id === pluginId);
    const outside = await mkdtemp(join(tmpdir(), "projector-plugin-readme-outside-"));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, "shot.png"), png);
    await symlink(join(outside, "shot.png"), join(plugin.path, "shot.png"));

    const origin = await apiOrigin();
    expect((await fetch(`${origin}${pluginReadmePath(pluginId, "shot.png")}`)).status).toBe(404);
  },
);
