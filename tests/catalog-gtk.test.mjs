import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { os } from "../core/modules/os/index.ts";

await test("real GioUnix catalog reads desktop application keywords", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-catalog-gtk-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(directory, "applications"));
  await writeFile(join(directory, "applications", "projector-catalog-probe.desktop"),
    "[Desktop Entry]\nType=Application\nName=Projector catalog probe\nExec=/bin/true\nKeywords=palette;workspace;\n");
  const catalog = await os.catalog();
  const app = catalog.listApplications().find(item => item.id === "app:projector-catalog-probe.desktop");
  assert.ok(app, "the application is present in the native catalog");
  assert.equal(app.name, "Projector catalog probe");
  assert.match(app.keywords, /palette/);
  assert.match(app.keywords, /workspace/);
});
