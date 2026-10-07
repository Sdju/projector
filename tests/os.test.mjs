import { expect, onTestFinished, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, mkdir, cp, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { os, createOs, UnsupportedPlatformError } from "../core/modules/os/index.ts";

// This file runs without GI loaders/display: importing os must not load GTK or D-Bus.
test("OS selection is automatic; unsupported systems never fall through to Linux operations", async () => {
  expect(os.platform).toBe(process.platform);
  const windows = createOs("win32");
  expect(windows.supported).toBe(true);
  expect(windows.capabilities.nativeDesktop).toBe(false);
  expect(windows.capabilities.processInspection).toBe(true);
  expect(windows.capabilities.fileOperations).toBe(true);
  const invocation = windows.shellLaunch({ kind: "command", command: "echo hi" });
  if (/powershell|pwsh/i.test(invocation.file))
    expect(invocation.args.includes("-Command")).toBeTruthy();
  else expect(invocation.args).toStrictEqual(["-c", "echo hi"]);
  await expect(
    windows.runDesktop("http://localhost", "show", {
      dataDirectory: "x",
      createPalette: async () => {
        throw new Error("палитра не создаётся");
      },
    }),
  ).rejects.toSatisfy(
    (error) => error instanceof UnsupportedPlatformError && error.code === "ERR_OS_UNSUPPORTED",
  );
  expect(await windows.shortcutStatus()).toStrictEqual({
    supported: false,
    active: false,
    shortcut: "",
  });
  for (const platform of ["darwin", "freebsd"]) {
    const adapter = createOs(platform);
    expect(adapter.supported).toBe(false);
    expect(adapter.capabilities.nativeDesktop).toBe(false);
    expect(adapter.processes.list()).toBe(null);
    for (const operation of [
      () => adapter.shell(),
      () => adapter.catalog(),
      () => adapter.windows.openBrowser("http://localhost"),
      () => adapter.tools.moveNoReplace("a", "b"),
    ]) {
      expect(operation).toThrow(UnsupportedPlatformError);
      expect(operation).toThrow(
        expect.objectContaining({
          code: "ERR_OS_UNSUPPORTED",
          message: expect.stringContaining(platform),
        }),
      );
    }
    expect(await adapter.shortcutStatus()).toStrictEqual({
      supported: false,
      active: false,
      shortcut: "",
    });
    expect(await adapter.desktopPid("dev.projector.Launcher")).toBe(undefined);
  }
});

test("Windows data directory follows an explicit XDG override, then LOCALAPPDATA", () => {
  const adapter = createOs("win32");
  const previousData = process.env.XDG_DATA_HOME;
  const previousLocal = process.env.LOCALAPPDATA;
  try {
    process.env.XDG_DATA_HOME = join("C:", "custom projector data");
    expect(adapter.dataHome()).toBe(process.env.XDG_DATA_HOME);
    delete process.env.XDG_DATA_HOME;
    process.env.LOCALAPPDATA = join("D:", "Local");
    expect(adapter.dataHome()).toBe(process.env.LOCALAPPDATA);
    expect(adapter.desktopPaths().bin).toBe(join(process.env.LOCALAPPDATA, "bin"));
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    if (previousLocal === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocal;
  }
});

test(
  "Windows process identity, family, cwd and restart wait use the same live process",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-process-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: directory,
      stdio: "ignore",
      windowsHide: true,
    });
    onTestFinished(() => child.kill());
    await once(child, "spawn");
    const identity = os.processes.identity(child.pid);
    expect(identity).toBeTruthy();
    expect(
      os.processes.descendants(process.pid).find((entry) => entry.pid === child.pid)?.started,
    ).toBe(identity);
    expect((await os.processes.workingDirectory(child.pid, "fallback")).toLowerCase()).toBe(
      directory.toLowerCase(),
    );
    await expect(os.processes.waitForExit(child.pid, 60)).rejects.toThrow(/не завершился/);
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await os.processes.waitForExit(child.pid, 1000);
    expect(os.processes.identity(child.pid)).toBe(null);
    expect(await os.processes.workingDirectory(child.pid, "fallback")).toBe("fallback");
  },
);

test(
  "Windows move preserves both files on a collision and handles Unicode paths",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-move-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "источник файл");
    const target = join(directory, "назначение файл");
    await writeFile(source, "source");
    await writeFile(target, "target");
    await os.tools.moveNoReplace(source, target);
    expect(await readFile(source, "utf8")).toBe("source");
    expect(await readFile(target, "utf8")).toBe("target");
    await rm(target);
    await os.tools.moveNoReplace(source, target);
    expect(await readFile(target, "utf8")).toBe("source");
    await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

test(
  "Windows install writes a Start menu shortcut and a command for a path with spaces",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-install-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const root = join(directory, "checkout with spaces");
    const previous = {
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    };
    process.env.APPDATA = join(directory, "roaming");
    process.env.LOCALAPPDATA = join(directory, "local");
    delete process.env.XDG_DATA_HOME;
    onTestFinished(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    await mkdir(join(root, "resources", "icons"), { recursive: true });
    await cp(
      new URL("../resources/icons/projector.svg", import.meta.url),
      join(root, "resources", "icons", "projector.svg"),
    );
    os.installDesktop(root);
    const command = join(directory, "local", "bin", "projector.cmd");
    expect(await readFile(command, "utf8")).toMatch(/checkout with spaces/);
    expect(
      existsSync(
        join(
          directory,
          "roaming",
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "Projector.lnk",
        ),
      ),
    ).toBe(true);
  },
);

test(
  "Linux paths follow the user environment rather than a checkout or account",
  { skip: process.platform !== "linux" },
  () => {
    const previous = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = "/tmp/custom projector data";
      expect(os.dataHome()).toBe(process.env.XDG_DATA_HOME);
      expect(os.desktopPaths().applications).toBe("/tmp/custom projector data/applications");
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  },
);

test(
  "Linux process identity, family, cwd and restart wait use the same live process",
  { skip: process.platform !== "linux" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-process-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: directory,
      stdio: "ignore",
    });
    onTestFinished(() => child.kill());
    await once(child, "spawn");
    const identity = os.processes.identity(child.pid);
    expect(identity).toBeTruthy();
    expect(os.processes.descendants(process.pid).find((p) => p.pid === child.pid)?.started).toBe(
      identity,
    );
    expect(await os.processes.workingDirectory(child.pid, "/fallback")).toBe(directory);
    await expect(os.processes.waitForExit(child.pid, 60)).rejects.toThrow(/не завершился/);
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await os.processes.waitForExit(child.pid, 100);
    expect(os.processes.identity(child.pid)).toBe(null);
    expect(await os.processes.workingDirectory(child.pid, "/fallback")).toBe("/fallback");
  },
);

test(
  "Linux move preserves both files on a collision and handles Unicode/space paths",
  { skip: process.platform !== "linux" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-move-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "источник файл");
    const target = join(directory, "назначение файл");
    await writeFile(source, "source");
    await writeFile(target, "target");
    await os.tools.moveNoReplace(source, target);
    expect(await readFile(source, "utf8")).toBe("source");
    expect(await readFile(target, "utf8")).toBe("target");
    await rm(target);
    await os.tools.moveNoReplace(source, target);
    expect(await readFile(target, "utf8")).toBe("source");
    await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

test(
  "desktop installation uses isolated XDG and keeps a relocated checkout with spaces executable",
  { skip: process.platform !== "linux" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-install-"));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const root = join(directory, "checkout with spaces");
    const home = join(directory, "home");
    const data = join(directory, "xdg with spaces");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(home);
    await mkdir(join(root, "resources"));
    await cp(new URL("../resources/icons", import.meta.url), join(root, "resources/icons"), {
      recursive: true,
    });
    const marker = join(directory, "launched.json");
    await writeFile(
      join(root, "bin/projector"),
      `#!${process.execPath}\nimport { writeFileSync } from "node:fs";writeFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));\n`,
    );
    const facade = new URL("../core/modules/os/index.ts", import.meta.url).href;
    const env = { ...process.env, HOME: home, XDG_DATA_HOME: data };
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { os } from ${JSON.stringify(facade)};os.installDesktop(process.argv[1]);`,
        root,
      ],
      { env },
    );
    expect(await readlink(join(home, ".local/bin/projector"))).toBe(join(root, "bin/projector"));
    expect(await readFile(join(data, "applications/projector.desktop"), "utf8")).toMatch(
      /Exec="[^\n]*checkout with spaces[^\n]*"/,
    );
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    execFileSync(
      process.execPath,
      [
        "--import",
        require.resolve("vio/register"),
        "--input-type=module",
        "-e",
        `import { os } from ${JSON.stringify(facade)};const catalog=await os.catalog();catalog.launchApplication("projector.desktop");`,
      ],
      { env },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        expect(JSON.parse(await readFile(marker, "utf8"))).toStrictEqual([]);
        return;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    expect.unreachable("GIO did not launch the relocated executable");
  },
);
