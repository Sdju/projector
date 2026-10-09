// Desktop pieces that only exist on macOS: the .app catalog, Keychain and process queries.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
