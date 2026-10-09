// Desktop pieces that only exist on macOS: the .app catalog, Keychain and process queries.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, onTestFinished, test } from "vite-plus/test";

const execute = promisify(execFile);
const mac = process.platform === "darwin";

test.skipIf(!mac)("the application catalog lists, launches and resolves .app bundles", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "projector-mac-home-")));
  const previous = process.env.HOME;
  process.env.HOME = home;
  onTestFinished(() => {
    process.env.HOME = previous;
  });
  const marker = join(home, "started");
  const app = join(home, "Applications", "Projector Probe.app");
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  await writeFile(
    join(app, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>probe</string><key>CFBundleIdentifier</key><string>dev.projector.probe</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`,
  );
  const executable = join(app, "Contents/MacOS/probe");
  await writeFile(executable, `#!/bin/sh\necho started > '${marker}'\n`, { mode: 0o755 });
  const { os } = await import("../core/modules/os/index.ts");
  const catalog = await os.catalog();
  const probe = (await catalog.listApplications()).find((item) => item.name === "Projector Probe");
  expect(probe).toBeTruthy();
  expect(probe.id).toBe(`app:${app}`);
  await catalog.launchApplication(app);
  for (let i = 0; i < 100; i++) {
    if (await readFile(marker, "utf8").catch(() => "")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect((await readFile(marker, "utf8")).trim()).toBe("started");
  expect(await catalog.applicationIcon(app)).toBe("");
  await expect(catalog.launchApplication(join(home, "outside.app"))).rejects.toThrow(/не доступно/);
});

test.skipIf(!mac)(
  "ps/lsof report identity, parents, foreground and working directory",
  async () => {
    const { os } = await import("../core/modules/os/index.ts");
    const directory = await realpath(await mkdtemp(join(tmpdir(), "projector-mac-cwd-")));
    const child = (await import("node:child_process")).spawn("sleep", ["30"], { cwd: directory });
    onTestFinished(() => child.kill());
    await new Promise((resolve) => setTimeout(resolve, 200));
    const list = await os.processes.list();
    const row = list.find((entry) => entry.pid === child.pid);
    expect(row).toMatchObject({ parent: process.pid, name: "sleep" });
    expect(await os.processes.identity(child.pid)).toBe(row.started);
    expect(await os.processes.workingDirectory(child.pid, "/")).toBe(directory);
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
    expect(await os.processes.identity(child.pid)).toBe(null);
    void execute;
  },
);

test.skipIf(!mac)(
  "the resident compiles its helper, owns one menu-bar item and registers the hotkey",
  async () => {
    const data = await realpath(await mkdtemp(join(tmpdir(), "projector-mac-resident-")));
    const entry = fileURLToPath(new URL("../native/app/entry.ts", import.meta.url));
    const env = { ...process.env, XDG_DATA_HOME: data };
    const { os } = await import("../core/modules/os/index.ts");
    const loader = os.capabilities.gtkPalette
      ? ["--import", pathToFileURL(createRequire(import.meta.url).resolve("vio/register")).href]
      : [];
    const run = (...args) =>
      execute(process.execPath, [...loader, entry, ...args], { env, timeout: 240_000 });
    const resident = spawn(
      process.execPath,
      [...loader, entry, "native", "http://127.0.0.1:9", "tray"],
      {
        env,
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    onTestFinished(async () => {
      await run("native", "http://127.0.0.1:9", "quit").catch(() => undefined);
      resident.kill();
    });
    let output = "";
    resident.stdout.on("data", (chunk) => (output += chunk));
    for (let i = 0; i < 2400 && !output.includes("READY"); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(output).toContain("READY");
    expect(output).toContain(os.capabilities.gtkPalette ? "PALETTE:gtk" : "PALETTE:web");
    const status = JSON.parse((await run("shortcut-status")).stdout);
    expect(status).toMatchObject({ supported: true, active: true, shortcut: "Ctrl+Alt+Space" });
    // A second launch forwards to the running resident instead of starting another.
    expect((await run("native", "http://127.0.0.1:9", "tray")).stdout).toContain("READY");
    await run("native", "http://127.0.0.1:9", "quit");
    for (let i = 0; i < 100 && resident.exitCode === null; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(resident.exitCode).toBe(0);
    expect(JSON.parse((await run("shortcut-status")).stdout).active).toBe(false);
  },
  300_000,
);

test.skipIf(!mac)(
  "the helper routes menu items and the registered hotkey to Projector events",
  async () => {
    const data = await realpath(await mkdtemp(join(tmpdir(), "projector-mac-helper-")));
    process.env.XDG_DATA_HOME = data;
    const { ensureHelper } = await import("../core/modules/os/modules/darwin/shell.ts");
    const helper = spawn(await ensureHelper(), [], {
      env: { ...process.env, PROJECTOR_SHELL_TEST: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    onTestFinished(() => helper.kill());
    const lines = [];
    helper.stdout.on("data", (chunk) => lines.push(...String(chunk).split("\n").filter(Boolean)));
    const next = async (line) => {
      for (let i = 0; i < 100 && !lines.includes(line); i++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(lines, line).toContain(line);
      lines.splice(lines.indexOf(line), 1);
    };
    await next("ready");
    helper.stdin.write("hotkey Ctrl+Alt+Space\n");
    await next("hotkey:ok");
    helper.stdin.write("press-hotkey\n");
    await next("event:hotkey");
    for (const [index, event] of ["activate", "settings", "restart", "quit"].entries()) {
      helper.stdin.write(`menu ${index}\n`);
      await next(`event:${event}`);
    }
    helper.stdin.write("hotkey Nonsense\n");
    await next("hotkey:none");
  },
  300_000,
);

test.skipIf(!mac || !existsSync("/Applications/Google Chrome.app"))(
  "the palette window is found by class, hidden, toggled back and closed",
  async () => {
    const data = await realpath(await mkdtemp(join(tmpdir(), "projector-mac-window-")));
    process.env.XDG_DATA_HOME = data;
    const { os } = await import("../core/modules/os/index.ts");
    const server = createServer((_, response) => response.end("<title>Palette</title>")).listen(0);
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/`;
    const cls = `ProjectorTest${process.pid}`;
    onTestFinished(() => {
      os.windows.closePalette(cls);
      server.close();
    });
    expect(os.windows.focusApp(cls)).toBe(false);
    os.windows.openPalette(url, false, cls, join(data, "profile"));
    const until = async (check) => {
      for (let i = 0; i < 300; i++) {
        if (await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    };
    expect(await until(() => os.windows.focusApp(cls))).toBe(true);
    os.windows.hidePalette(cls);
    await new Promise((resolve) => setTimeout(resolve, 500));
    os.windows.openPalette(url, true, cls, join(data, "profile"));
    expect(os.windows.focusApp(cls)).toBe(true);
    os.windows.closePalette(cls);
    expect(await until(() => !os.windows.focusApp(cls))).toBe(true);
  },
  300_000,
);

// Real HID events need the Accessibility/Input Monitoring grant; hosted runners allow it.
test.skipIf(!mac)(
  "a real key press and a real click on the menu-bar item reach the helper",
  async () => {
    const data = await realpath(await mkdtemp(join(tmpdir(), "projector-mac-input-")));
    process.env.XDG_DATA_HOME = data;
    const { ensureHelper } = await import("../core/modules/os/modules/darwin/shell.ts");
    const helper = spawn(await ensureHelper(), [], {
      env: { ...process.env, PROJECTOR_SHELL_TEST: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    onTestFinished(() => helper.kill());
    const lines = [];
    helper.stdout.on("data", (chunk) => lines.push(...String(chunk).split("\n").filter(Boolean)));
    const next = async (line, seconds = 15) => {
      for (let i = 0; i < seconds * 10 && !lines.includes(line); i++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      expect(lines, line).toContain(line);
      lines.splice(lines.indexOf(line), 1);
    };
    await next("ready");
    helper.stdin.write("hotkey Ctrl+Alt+Space\n");
    await next("hotkey:ok");
    helper.stdin.write("real-hotkey\n");
    await next("event:hotkey");
    helper.stdin.write("real-click\n");
    await next("menu:open");
    helper.stdin.write("real-key 125\n"); // Down arrow highlights an item
    await new Promise((resolve) => setTimeout(resolve, 300));
    helper.stdin.write("real-key 36\n"); // Return chooses it
    await next("menu:close");
    // Which row the first arrow lands on depends on the menu's initial highlight.
    expect(lines.some((line) => /^event:(activate|settings|restart|quit)$/.test(line))).toBe(true);
  },
  120_000,
);
