import { expect, onTestFinished, test } from "vite-plus/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { os } from "../core/modules/os/index.ts";
import { startDesktopShell } from "../core/modules/os/modules/windows/shell.ts";

test(
  "Windows tray host registers a hotkey and releases it on exit",
  { skip: process.platform !== "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "projector-win-tray-"));
    const data = join(root, "projector");
    await mkdir(data);
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = root;
    await writeFile(join(data, "launcher.pid"), `${process.pid}\n`);
    const shell = await startDesktopShell(data, {
      onActivate() {},
      onHotkey() {},
      onSettings() {},
      onRestart() {},
      onQuit() {},
    });
    onTestFinished(async () => {
      await shell.stop();
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
      await rm(root, { recursive: true, force: true });
    });
    const result = await shell.configure("Ctrl+Alt+Space");
    expect(["registered", "busy"]).toContain(result);
    const status = await os.shortcutStatus();
    expect(status.supported).toBe(true);
    if (result === "registered") {
      expect(status).toMatchObject({ active: true, shortcut: "Ctrl+Alt+Space" });
      expect(await os.shortcutAvailable("Ctrl+Alt+Space")).toEqual({
        supported: true,
        available: true,
      });
    } else expect(status.active).toBe(false);
    await shell.stop();
    expect(await os.shortcutStatus()).toEqual({ supported: true, active: false, shortcut: "" });
  },
);
