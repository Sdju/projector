import { mkdtemp, mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { expect, onTestFinished, test } from "vite-plus/test";

const root = await mkdtemp(join(tmpdir(), "projector-check-"));
const data = join(root, "data");
const apps = join(data, "applications");
await mkdir(apps, { recursive: true });
await mkdir(join(data, "projector"), { recursive: true });
const mac = process.platform === "darwin";
// macOS lists .app bundles from ~/Applications instead of .desktop entries.
const bundle = join(root, "Applications", "Projector Probe.app");
const appId = mac ? `app:${bundle}` : "app:projector probe.desktop";
if (mac) {
  process.env.HOME = root;
  await mkdir(join(bundle, "Contents/MacOS"), { recursive: true });
  await writeFile(
    join(bundle, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>probe</string><key>CFBundleIdentifier</key><string>dev.projector.launcher-probe</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  // The bundle reports the name and path it was really started from.
  await writeFile(
    join(bundle, "Contents/MacOS/probe"),
    `#!/bin/sh\nroot="$(cd "$(dirname "$0")/../.." && pwd -P)"\nprintf '["%s","%s"]' "$(basename "$root" .app)" "$root" > '${join(root, "launched.json")}'\n`,
    { mode: 0o755 },
  );
  const background = join(root, "Applications", "Projector Hidden.app");
  await mkdir(join(background, "Contents"), { recursive: true });
  await writeFile(
    join(background, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.projector.hidden</string><key>LSBackgroundOnly</key><true/></dict></plist>`,
  );
}
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

  test.skipIf(process.platform === "win32")(
    "shared launcher handles installed apps, desktop Exec codes, projects and saved settings",
    async () => {
      onTestFinished(() => server.close());
      const results = await searchLauncher("Projector Probe");
      expect(results.warning).toBe(undefined);
      expect(results.items[0].id).toBe(appId);
      expect((await searchLauncher("Projector Hidden")).items.length).toBe(0);
      expect((await searchLauncher("Probe workspace")).items[0].id).toBe("project:probe-project");
      expect((await searchLauncher("qzxv-no-such-app")).items.length).toBe(0);
      expect(
        matchScore({ name: "Chromium", keywords: "", description: "" }, "chrm") > 0,
      ).toBeTruthy();
      expect(matchScore({ name: "Chromium", keywords: "", description: "" }, "qqq")).toBe(-1);
      const initialSettings = await (await request("/api/launcher/settings")).json();
      expect(initialSettings.mode).toBe("native");
      expect(initialSettings.shortcut).toBe("Ctrl+Alt+Space");
      expect((await request("/api/launcher/settings", "PUT", { mode: "bogus" })).status).toBe(400);
      expect(
        (await request("/api/launcher/settings", "PUT", { mode: "native", shortcut: "invalid" }))
          .status,
      ).toBe(400);
      for (const mode of ["browser", "window", "native"]) {
        expect((await request("/api/launcher/settings", "PUT", { mode })).status).toBe(200);
        expect((await (await request("/api/launcher/settings")).json()).mode).toBe(mode);
      }
      expect(
        (await request("/api/launcher/launch", "POST", { id: "app:/tmp/untrusted.desktop" }))
          .status,
      ).toBe(400);
      expect(
        (
          await request(
            "/api/launcher/launch",
            "POST",
            { id: appId },
            { Origin: "https://untrusted.example" },
          )
        ).status,
      ).toBe(403);
      const launches = await Promise.all(
        [1, 2].map(() => request("/api/launcher/launch", "POST", { id: appId })),
      );
      for (const response of launches) expect(response.status, await response.text()).toBe(200);
      // GIO confirms process creation, before the launched Node script writes its result.
      const launchDeadline = Date.now() + 3000;
      let launched;
      while (!launched && Date.now() < launchDeadline) {
        launched = await readFile(join(root, "launched.json"), "utf8").catch(() => undefined);
        if (!launched) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(launched, "The desktop application produced its result").toBeTruthy();
      const args = JSON.parse(launched);
      expect(args[0]).toBe("Projector Probe");
      expect(args[1]).toBe(mac ? await realpath(bundle) : join(apps, "projector probe.desktop"));
      const settings = JSON.parse(await readFile(join(data, "projector", "launcher.json"), "utf8"));
      expect(settings.usage[appId].count).toBe(2);
      expect((await searchLauncher("")).items[0].id).toBe(appId);
      const browsed = (await searchLauncher("")).items;
      expect(browsed[0].section).toBe("recent");
      expect(browsed.every((item) => item.section)).toBeTruthy();
      expect(new Set(browsed.map((item) => item.id)).size).toBe(browsed.length);
      expect(
        browsed.some((item) => item.id === "project:probe-project" && item.section === "projects"),
      ).toBeTruthy();
      expect((await searchLauncher("Probe workspace")).items[0].section).toBe(undefined);
      const projectItem = (await searchLauncher("Probe workspace")).items[0];
      expect(projectItem.actions.map((action) => action.id)).toStrictEqual(["open", "run"]);
      expect(
        (await searchLauncher("Projector Probe")).items[0].actions.map((action) => action.id),
      ).toStrictEqual(["launch"]);
      const opened = await (
        await request("/api/launcher/launch", "POST", {
          id: "project:probe-project",
          action: "open",
          inline: true,
        })
      ).json();
      expect(opened.route).toMatch(/^\/projects\//);
      expect(projectItem.status).toBe(undefined);
      expect(
        (
          await request("/api/launcher/launch", "POST", {
            id: "project:probe-project",
            action: "stop",
          })
        ).status,
      ).toBe(200);
      expect(getSnapshot("probe-project").status).toBe("idle");
      expect(
        (
          await request("/api/launcher/launch", "POST", {
            id: appId,
            action: "open",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request("/api/launcher/launch", "POST", {
            id: "project:probe-project",
            action: "run",
          })
        ).status,
      ).toBe(200);
      const deadline = Date.now() + 3000;
      while (
        ["starting", "running"].includes(getSnapshot("probe-project").status) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const runtime = getSnapshot("probe-project");
      expect(runtime.commandId).toBe("dev");
      expect(runtime.status).toBe("idle");
      expect(runtime.exitCode).toBe(0);
      // Prefixes: "/" keeps only projects, "gh/" switches to GitHub.
      const scoped = await searchLauncher("/");
      expect(
        scoped.items.length >= 2 && scoped.items.every((item) => item.kind === "project"),
      ).toBeTruthy();
      expect(
        (await searchLauncher("/workspace")).items.map((item) => item.id).sort(),
      ).toStrictEqual(["project:fail-project", "project:probe-project"]);
      expect(
        (await searchLauncher("/Projector Probe")).items.every((item) => item.kind === "project"),
      ).toBeTruthy();
      const noToken = await searchLauncher("gh/");
      expect(noToken.items).toStrictEqual([]);
      expect(noToken.warning).toMatch(/GitHub/);
      // Favorites float to the top of text search and open the browse view; unknown ids are refused.
      const toggle = (id) =>
        request("/api/launcher/launch", "POST", { id, action: "favorite" }).then((res) =>
          res.status === 200 ? res.json() : res.status,
        );
      expect(await toggle("project:nope")).toBe(400);
      expect(await toggle("gh:Sdju/projector")).toBe(400);
      expect(await toggle("app:../../etc.desktop")).toBe(400);
      const before = (await searchLauncher("workspace")).items.map((item) => item.id);
      expect(before.includes("project:fail-project")).toBe(true);
      expect((await toggle("project:fail-project")).favorite).toBe(true);
      const after = (await searchLauncher("workspace")).items;
      expect(after[0].id).toBe("project:fail-project");
      expect(after[0].favorite).toBe(true);
      expect(after.find((item) => item.id === "project:probe-project").favorite).toBe(undefined);
      expect((await toggle(appId)).favorite).toBe(true);
      const favoriteBrowse = (await searchLauncher("")).items;
      expect(
        favoriteBrowse
          .filter((item) => item.section === "favorites")
          .map((item) => item.id)
          .sort(),
      ).toStrictEqual([appId, "project:fail-project"]);
      expect(favoriteBrowse[0].section).toBe("favorites");
      expect(new Set(favoriteBrowse.map((item) => item.id)).size).toBe(favoriteBrowse.length);
      expect((await launchDetail("project:fail-project")).actions.at(-1).title).toBe(
        "Убрать из избранного",
      );
      expect((await launchDetail(appId)).actions.at(-1).title).toBe("Убрать из избранного");
      expect((await toggle("project:fail-project")).favorite).toBe(false);
      expect((await toggle(appId)).favorite).toBe(false);
      expect((await launchDetail("project:fail-project")).actions.at(-1).title).toBe(
        "Добавить в избранное",
      );
      expect((await searchLauncher("")).items.some((item) => item.section === "favorites")).toBe(
        false,
      );
      // Detail lists a run action per command; a failed run exposes its terminal output.
      const idleDetail = await launchDetail("project:fail-project");
      expect(idleDetail.actions.map((action) => [action.id, action.arg])).toStrictEqual([
        ["open", undefined],
        ["run", "boom"],
        ["run", "other"],
        ["window", "boom"],
        ["folder", undefined],
        ["favorite", undefined],
      ]);
      expect(idleDetail.failure).toBe(undefined);
      expect(idleDetail.info.state).toBe("idle");
      expect(idleDetail.info.docker).toBe(undefined);
      expect(idleDetail.info.path.length > 0).toBeTruthy();
      expect(
        (
          await request("/api/launcher/launch", "POST", {
            id: "project:fail-project",
            action: "browser",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request("/api/launcher/launch", "POST", {
            id: "project:fail-project",
            action: "run",
            arg: "boom",
          })
        ).status,
      ).toBe(200);
      const failDeadline = Date.now() + 5000;
      while (getSnapshot("fail-project").status !== "error" && Date.now() < failDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(getSnapshot("fail-project").commandId).toBe("boom");
      const failed = await (await request("/api/launcher/detail?id=project%3Afail-project")).json();
      expect(failed.failure.exitCode).toBe(3);
      expect(failed.info.state).toBe("error");
      expect(failed.info.stateLabel).toBe("ошибка запуска");
      expect(failed.info.command).toBe("boom");
      expect(failed.failure.command).toBe("boom");
      expect(failed.failure.output).toMatch(/boom-output/);
      expect((await searchLauncher("Failing workspace")).items[0].status.state).toBe("error");
      const reloaded = await import("../server/modules/processes/processes.ts?reload-check");
      expect(reloaded.getSnapshot("probe-project").commandId).toBe("dev");
      expect(reloaded.getSnapshot("probe-project").exitCode).toBe(0);
    },
  );
}
