import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, mkdir, cp, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { os, createOs, UnsupportedPlatformError } from "../core/modules/os/index.ts";

// This file runs without GI loaders/display: importing os must not load GTK or D-Bus.
test("OS selection is automatic; unsupported systems never fall through to Linux operations", async () => {
  assert.equal(os.platform, process.platform);
  const windows = createOs("win32");
  assert.equal(windows.supported, true);
  assert.equal(windows.capabilities.nativeDesktop, false);
  assert.equal(windows.capabilities.processInspection, true);
  assert.equal(windows.capabilities.fileOperations, true);
  const invocation = windows.shellLaunch({ kind: "command", command: "echo hi" });
  if (/powershell|pwsh/i.test(invocation.file)) assert.ok(invocation.args.includes("-Command"));
  else assert.deepEqual(invocation.args, ["-c", "echo hi"]);
  await assert.rejects(
    windows.runDesktop("http://localhost", "show", {
      dataDirectory: "x",
      createPalette: async () => {
        throw new Error("палитра не создаётся");
      },
    }),
    (error) => error instanceof UnsupportedPlatformError && error.code === "ERR_OS_UNSUPPORTED",
  );
  assert.deepEqual(await windows.shortcutStatus(), {
    supported: false,
    active: false,
    shortcut: "",
  });
  for (const platform of ["darwin", "freebsd"]) {
    const adapter = createOs(platform);
    assert.equal(adapter.supported, false);
    assert.equal(adapter.capabilities.nativeDesktop, false);
    assert.equal(adapter.processes.list(), null);
    for (const operation of [
      () => adapter.shell(),
      () => adapter.catalog(),
      () => adapter.windows.openBrowser("http://localhost"),
      () => adapter.tools.moveNoReplace("a", "b"),
    ]) {
      assert.throws(
        operation,
        (error) =>
          error instanceof UnsupportedPlatformError &&
          error.code === "ERR_OS_UNSUPPORTED" &&
          error.message.includes(platform),
      );
    }
    assert.deepEqual(await adapter.shortcutStatus(), {
      supported: false,
      active: false,
      shortcut: "",
    });
    assert.equal(await adapter.desktopPid("dev.projector.Launcher"), undefined);
  }
});

test("Windows data directory follows an explicit XDG override, then LOCALAPPDATA", () => {
  const adapter = createOs("win32");
  const previousData = process.env.XDG_DATA_HOME;
  const previousLocal = process.env.LOCALAPPDATA;
  try {
    process.env.XDG_DATA_HOME = join("C:", "custom projector data");
    assert.equal(adapter.dataHome(), process.env.XDG_DATA_HOME);
    delete process.env.XDG_DATA_HOME;
    process.env.LOCALAPPDATA = join("D:", "Local");
    assert.equal(adapter.dataHome(), process.env.LOCALAPPDATA);
    assert.equal(adapter.desktopPaths().bin, join(process.env.LOCALAPPDATA, "bin"));
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
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-process-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: directory,
      stdio: "ignore",
      windowsHide: true,
    });
    t.after(() => child.kill());
    await once(child, "spawn");
    const identity = os.processes.identity(child.pid);
    assert.ok(identity);
    assert.equal(
      os.processes.descendants(process.pid).find((entry) => entry.pid === child.pid)?.started,
      identity,
    );
    assert.equal(
      (await os.processes.workingDirectory(child.pid, "fallback")).toLowerCase(),
      directory.toLowerCase(),
    );
    await assert.rejects(os.processes.waitForExit(child.pid, 60), /не завершился/);
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await os.processes.waitForExit(child.pid, 1000);
    assert.equal(os.processes.identity(child.pid), null);
    assert.equal(await os.processes.workingDirectory(child.pid, "fallback"), "fallback");
  },
);

test(
  "Windows move preserves both files on a collision and handles Unicode paths",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-move-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "источник файл");
    const target = join(directory, "назначение файл");
    await writeFile(source, "source");
    await writeFile(target, "target");
    await os.tools.moveNoReplace(source, target);
    assert.equal(await readFile(source, "utf8"), "source");
    assert.equal(await readFile(target, "utf8"), "target");
    await rm(target);
    await os.tools.moveNoReplace(source, target);
    assert.equal(await readFile(target, "utf8"), "source");
    await assert.rejects(readFile(source), { code: "ENOENT" });
  },
);

test(
  "Windows install writes a Start menu shortcut and a command for a path with spaces",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-install-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const root = join(directory, "checkout with spaces");
    const previous = {
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    };
    process.env.APPDATA = join(directory, "roaming");
    process.env.LOCALAPPDATA = join(directory, "local");
    delete process.env.XDG_DATA_HOME;
    t.after(() => {
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
    assert.match(await readFile(command, "utf8"), /checkout with spaces/);
    assert.equal(
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
      true,
    );
  },
);

test(
  "Linux paths follow the user environment rather than a checkout or account",
  { skip: process.platform !== "linux" },
  () => {
    const previous = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = "/tmp/custom projector data";
      assert.equal(os.dataHome(), process.env.XDG_DATA_HOME);
      assert.equal(os.desktopPaths().applications, "/tmp/custom projector data/applications");
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  },
);

test(
  "Linux process identity, family, cwd and restart wait use the same live process",
  { skip: process.platform !== "linux" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-process-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: directory,
      stdio: "ignore",
    });
    t.after(() => child.kill());
    await once(child, "spawn");
    const identity = os.processes.identity(child.pid);
    assert.ok(identity);
    assert.equal(
      os.processes.descendants(process.pid).find((p) => p.pid === child.pid)?.started,
      identity,
    );
    assert.equal(await os.processes.workingDirectory(child.pid, "/fallback"), directory);
    await assert.rejects(os.processes.waitForExit(child.pid, 60), /не завершился/);
    const exited = once(child, "exit");
    child.kill();
    await exited;
    await os.processes.waitForExit(child.pid, 100);
    assert.equal(os.processes.identity(child.pid), null);
    assert.equal(await os.processes.workingDirectory(child.pid, "/fallback"), "/fallback");
  },
);

test(
  "Linux move preserves both files on a collision and handles Unicode/space paths",
  { skip: process.platform !== "linux" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-move-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "источник файл");
    const target = join(directory, "назначение файл");
    await writeFile(source, "source");
    await writeFile(target, "target");
    await os.tools.moveNoReplace(source, target);
    assert.equal(await readFile(source, "utf8"), "source");
    assert.equal(await readFile(target, "utf8"), "target");
    await rm(target);
    await os.tools.moveNoReplace(source, target);
    assert.equal(await readFile(target, "utf8"), "source");
    await assert.rejects(readFile(source), { code: "ENOENT" });
  },
);

test(
  "desktop installation uses isolated XDG and keeps a relocated checkout with spaces executable",
  { skip: process.platform !== "linux" },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "projector-os-install-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
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
    assert.equal(await readlink(join(home, ".local/bin/projector")), join(root, "bin/projector"));
    assert.match(
      await readFile(join(data, "applications/projector.desktop"), "utf8"),
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
        assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), []);
        return;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.fail("GIO did not launch the relocated executable");
  },
);
