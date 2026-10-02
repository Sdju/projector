import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";

const root = await mkdtemp(join(tmpdir(), "projector-check-"));
const data = join(root, "data");
const apps = join(data, "applications");
await mkdir(apps, { recursive: true });
await mkdir(join(data, "projector"), { recursive: true });
const probe = join(root, "launch probe.mjs");
await writeFile(probe, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(join(root, "launched.json"))}, JSON.stringify(process.argv.slice(2)));\n`);
await writeFile(join(apps, "projector probe.desktop"), `[Desktop Entry]\nType=Application\nName=Projector Probe\nComment=Safe launcher verification\nExec="${process.execPath}" "${probe}" %c %k\nIcon=utilities-terminal\nTerminal=false\n`);
await writeFile(join(apps, "projector-hidden.desktop"), `[Desktop Entry]\nType=Application\nName=Projector Hidden\nExec=/usr/bin/true\nNoDisplay=true\n`);
await writeFile(join(data, "projector", "projects.json"), JSON.stringify({ projects: [{
  id: "probe-project", name: "Probe workspace", path: root, url: "", icon: "", mode: "server",
  defaultCommandId: "dev", commands: [{ id: "dev", name: "dev", cmd: "/usr/bin/true" }], createdAt: "2026-10-01",
}] }));

if (process.argv.includes("--prepare")) {
  console.log(JSON.stringify({ root, data }));
} else {
  process.env.XDG_DATA_HOME = data;
  const { searchLauncher, matchScore } = await import("../server/launcher.ts");
  const { handleApi } = await import("../server/api.ts");
  const { getSnapshot } = await import("../server/processes.ts");
  const server = createServer((req, res) => { void handleApi(req, res); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body, extraHeaders = {}) => fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  await test("shared launcher handles installed apps, desktop Exec codes, projects and saved settings", async (t) => {
    t.after(() => server.close());
    const results = await searchLauncher("Projector Probe");
    assert.equal(results.warning, undefined);
    assert.equal(results.items[0].id, "app:projector probe.desktop");
    assert.equal((await searchLauncher("Projector Hidden")).items.length, 0);
    assert.equal((await searchLauncher("Probe workspace")).items[0].id, "project:probe-project");
    assert.equal((await searchLauncher("qzxv-no-such-app")).items.length, 0);
    assert.ok(matchScore({ name: "Chromium", keywords: "", description: "" }, "chrm") > 0);
    assert.equal(matchScore({ name: "Chromium", keywords: "", description: "" }, "qqq"), -1);
    const initialSettings = await (await request("/api/launcher/settings")).json();
    assert.equal(initialSettings.mode, "native");
    assert.equal(initialSettings.shortcut, "Ctrl+Alt+Space");
    assert.equal((await request("/api/launcher/settings", "PUT", { mode: "bogus" })).status, 400);
    assert.equal((await request("/api/launcher/settings", "PUT", { mode: "native", shortcut: "invalid" })).status, 400);
    for (const mode of ["browser", "window", "native"]) {
      assert.equal((await request("/api/launcher/settings", "PUT", { mode })).status, 200);
      assert.equal((await (await request("/api/launcher/settings")).json()).mode, mode);
    }
    assert.equal((await request("/api/launcher/launch", "POST", { id: "app:/tmp/untrusted.desktop" })).status, 400);
    assert.equal((await request("/api/launcher/launch", "POST", { id: "app:projector probe.desktop" }, { Origin: "https://untrusted.example" })).status, 403);
    const launches = await Promise.all([1, 2].map(() => request("/api/launcher/launch", "POST", { id: "app:projector probe.desktop" })));
    for (const response of launches) assert.equal(response.status, 200, await response.text());
    // GIO confirms process creation, before the launched Node script writes its result.
    const launchDeadline = Date.now() + 3000;
    let launched;
    while (!launched && Date.now() < launchDeadline) {
      launched = await readFile(join(root, "launched.json"), "utf8").catch(() => undefined);
      if (!launched) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(launched, "The desktop application produced its result");
    const args = JSON.parse(launched);
    assert.equal(args[0], "Projector Probe");
    assert.equal(args[1], join(apps, "projector probe.desktop"));
    const settings = JSON.parse(await readFile(join(data, "projector", "launcher.json"), "utf8"));
    assert.equal(settings.usage["app:projector probe.desktop"].count, 2);
    assert.equal((await searchLauncher("")).items[0].id, "app:projector probe.desktop");
    assert.equal((await request("/api/launcher/launch", "POST", { id: "project:probe-project" })).status, 200);
    const deadline = Date.now() + 3000;
    while (["starting", "running"].includes(getSnapshot("probe-project").status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const runtime = getSnapshot("probe-project");
    assert.equal(runtime.commandId, "dev");
    assert.equal(runtime.status, "idle");
    assert.equal(runtime.exitCode, 0);
    const reloaded = await import("../server/processes.ts?reload-check");
    assert.equal(reloaded.getSnapshot("probe-project").commandId, "dev");
    assert.equal(reloaded.getSnapshot("probe-project").exitCode, 0);
  });
}
