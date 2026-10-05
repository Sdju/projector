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
await writeFile(
  probe,
  `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(join(root, "launched.json"))}, JSON.stringify(process.argv.slice(2)));\n`,
);
await writeFile(
  join(apps, "projector probe.desktop"),
  `[Desktop Entry]\nType=Application\nName=Projector Probe\nComment=Safe launcher verification\nExec="${process.execPath}" "${probe}" %c %k\nIcon=utilities-terminal\nTerminal=false\n`,
);
await writeFile(
  join(apps, "projector-hidden.desktop"),
  `[Desktop Entry]\nType=Application\nName=Projector Hidden\nExec=/usr/bin/true\nNoDisplay=true\n`,
);
await writeFile(
  join(data, "projector", "projects.json"),
  JSON.stringify({
    projects: [
      {
        id: "probe-project",
        name: "Probe workspace",
        path: root,
        url: "",
        icon: "",
        mode: "server",
        defaultCommandId: "dev",
        commands: [{ id: "dev", name: "dev", cmd: "/usr/bin/true" }],
        createdAt: "2026-10-01",
      },
      {
        id: "fail-project",
        name: "Failing workspace",
        path: root,
        url: "",
        icon: "",
        mode: "server",
        defaultCommandId: "boom",
        commands: [
          { id: "boom", name: "boom", cmd: "echo boom-output; exit 3" },
          { id: "other", name: "other", cmd: "/usr/bin/true" },
        ],
        createdAt: "2026-10-02",
      },
    ],
  }),
);

if (process.argv.includes("--prepare")) {
  console.log(JSON.stringify({ root, data }));
} else {
  process.env.XDG_DATA_HOME = data;
  const { searchLauncher, matchScore, launchDetail } =
    await import("../server/modules/launcher/index.ts");
  const { handleApi } = await import("../server/app/api.ts");
  const { getSnapshot } = await import("../server/modules/processes/index.ts");
  const server = createServer((req, res) => {
    void handleApi(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body, extraHeaders = {}) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...extraHeaders },
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
    assert.equal(
      (await request("/api/launcher/settings", "PUT", { mode: "native", shortcut: "invalid" }))
        .status,
      400,
    );
    for (const mode of ["browser", "window", "native"]) {
      assert.equal((await request("/api/launcher/settings", "PUT", { mode })).status, 200);
      assert.equal((await (await request("/api/launcher/settings")).json()).mode, mode);
    }
    assert.equal(
      (await request("/api/launcher/launch", "POST", { id: "app:/tmp/untrusted.desktop" })).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/launcher/launch",
          "POST",
          { id: "app:projector probe.desktop" },
          { Origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    const launches = await Promise.all(
      [1, 2].map(() =>
        request("/api/launcher/launch", "POST", { id: "app:projector probe.desktop" }),
      ),
    );
    for (const response of launches) assert.equal(response.status, 200, await response.text());
    // GIO confirms process creation, before the launched Node script writes its result.
    const launchDeadline = Date.now() + 3000;
    let launched;
    while (!launched && Date.now() < launchDeadline) {
      launched = await readFile(join(root, "launched.json"), "utf8").catch(() => undefined);
      if (!launched) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(launched, "The desktop application produced its result");
    const args = JSON.parse(launched);
    assert.equal(args[0], "Projector Probe");
    assert.equal(args[1], join(apps, "projector probe.desktop"));
    const settings = JSON.parse(await readFile(join(data, "projector", "launcher.json"), "utf8"));
    assert.equal(settings.usage["app:projector probe.desktop"].count, 2);
    assert.equal((await searchLauncher("")).items[0].id, "app:projector probe.desktop");
    const browsed = (await searchLauncher("")).items;
    assert.equal(browsed[0].section, "recent");
    assert.ok(browsed.every((item) => item.section));
    assert.equal(new Set(browsed.map((item) => item.id)).size, browsed.length);
    assert.ok(
      browsed.some((item) => item.id === "project:probe-project" && item.section === "projects"),
    );
    assert.equal((await searchLauncher("Probe workspace")).items[0].section, undefined);
    const projectItem = (await searchLauncher("Probe workspace")).items[0];
    assert.deepEqual(
      projectItem.actions.map((action) => action.id),
      ["open", "run"],
    );
    assert.deepEqual(
      (await searchLauncher("Projector Probe")).items[0].actions.map((action) => action.id),
      ["launch"],
    );
    const opened = await (
      await request("/api/launcher/launch", "POST", {
        id: "project:probe-project",
        action: "open",
        inline: true,
      })
    ).json();
    assert.match(opened.route, /^\/projects\//);
    assert.equal(projectItem.status, undefined);
    assert.equal(
      (
        await request("/api/launcher/launch", "POST", {
          id: "project:probe-project",
          action: "stop",
        })
      ).status,
      200,
    );
    assert.equal(getSnapshot("probe-project").status, "idle");
    assert.equal(
      (
        await request("/api/launcher/launch", "POST", {
          id: "app:projector probe.desktop",
          action: "open",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/launcher/launch", "POST", {
          id: "project:probe-project",
          action: "run",
        })
      ).status,
      200,
    );
    const deadline = Date.now() + 3000;
    while (
      ["starting", "running"].includes(getSnapshot("probe-project").status) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const runtime = getSnapshot("probe-project");
    assert.equal(runtime.commandId, "dev");
    assert.equal(runtime.status, "idle");
    assert.equal(runtime.exitCode, 0);
    // Prefixes: "/" keeps only projects, "gh/" switches to GitHub.
    const scoped = await searchLauncher("/");
    assert.ok(scoped.items.length >= 2 && scoped.items.every((item) => item.kind === "project"));
    assert.deepEqual((await searchLauncher("/workspace")).items.map((item) => item.id).sort(), [
      "project:fail-project",
      "project:probe-project",
    ]);
    assert.ok(
      (await searchLauncher("/Projector Probe")).items.every((item) => item.kind === "project"),
    );
    const noToken = await searchLauncher("gh/");
    assert.deepEqual(noToken.items, []);
    assert.match(noToken.warning, /GitHub/);
    // Detail lists a run action per command; a failed run exposes its terminal output.
    const idleDetail = await launchDetail("project:fail-project");
    assert.deepEqual(
      idleDetail.actions.map((action) => [action.id, action.arg]),
      [
        ["open", undefined],
        ["run", "boom"],
        ["run", "other"],
        ["window", "boom"],
      ],
    );
    assert.equal(idleDetail.failure, undefined);
    assert.equal(idleDetail.info.state, "idle");
    assert.equal(idleDetail.info.docker, undefined);
    assert.ok(idleDetail.info.path.length > 0);
    assert.equal(
      (
        await request("/api/launcher/launch", "POST", {
          id: "project:fail-project",
          action: "browser",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/launcher/launch", "POST", {
          id: "project:fail-project",
          action: "run",
          arg: "boom",
        })
      ).status,
      200,
    );
    const failDeadline = Date.now() + 5000;
    while (getSnapshot("fail-project").status !== "error" && Date.now() < failDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(getSnapshot("fail-project").commandId, "boom");
    const failed = await (await request("/api/launcher/detail?id=project%3Afail-project")).json();
    assert.equal(failed.failure.exitCode, 3);
    assert.equal(failed.info.state, "error");
    assert.equal(failed.info.stateLabel, "ошибка запуска");
    assert.equal(failed.info.command, "boom");
    assert.equal(failed.failure.command, "boom");
    assert.match(failed.failure.output, /boom-output/);
    assert.equal((await searchLauncher("Failing workspace")).items[0].status.state, "error");
    const reloaded = await import("../server/modules/processes/processes.ts?reload-check");
    assert.equal(reloaded.getSnapshot("probe-project").commandId, "dev");
    assert.equal(reloaded.getSnapshot("probe-project").exitCode, 0);
  });
}
