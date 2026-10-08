// Desktop pieces that only exist on Windows: the Start Menu catalog and a real GTK window.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vite-plus/test";
import { os } from "../core/modules/os/index.ts";
import { runPowerShell } from "../core/modules/os/modules/windows/ps.ts";

const windows = process.platform === "win32";

test.skipIf(!windows)("Start Menu catalog lists, launches and resolves shortcuts", async () => {
  const root = await mkdtemp(join(tmpdir(), "projector-startmenu-"));
  const previous = { appdata: process.env.APPDATA, programdata: process.env.ProgramData };
  onTestFinished(async () => {
    process.env.APPDATA = previous.appdata;
    process.env.ProgramData = previous.programdata;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const programs = join(root, "roaming", "Microsoft", "Windows", "Start Menu", "Programs");
  await mkdir(programs, { recursive: true });
  await mkdir(join(root, "common"), { recursive: true });
  process.env.APPDATA = join(root, "roaming");
  process.env.ProgramData = join(root, "common");
  const marker = join(root, "launched.txt");
  const script = join(root, "probe.mjs");
  await writeFile(
    script,
    `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "started");`,
  );
  await runPowerShell(
    `
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($env:LINK)
$link.TargetPath = $env:NODE
$link.Arguments = '"' + $env:SCRIPT + '"'
$link.Save()
`,
    {
      env: { LINK: join(programs, "Projector Probe.lnk"), NODE: process.execPath, SCRIPT: script },
    },
  );
  const catalog = await os.catalog();
  const items = await catalog.listApplications();
  const probe = items.find((item) => item.name === "Projector Probe");
  expect(probe, JSON.stringify(items)).toBeTruthy();
  expect(probe.id).toMatch(/^app:.*Projector Probe\.lnk$/);
  expect(probe.keywords.toLowerCase()).toContain("node");
  await catalog.launchApplication(probe.id.slice(4));
  for (let i = 0; i < 100; i++) {
    if (await readFile(marker, "utf8").catch(() => "")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(await readFile(marker, "utf8")).toBe("started");
  await expect(catalog.launchApplication(join(root, "outside.lnk"))).rejects.toThrow(/не доступно/);
});

test.skipIf(!windows)("a real GTK window gets an HWND that the adapter can raise", async () => {
  const { default: Gtk } = await import("gi:Gtk-4.0");
  const { default: GLib } = await import("gi:GLib-2.0");
  Gtk.init();
  const context = GLib.MainLoop.new(null, false).getContext();
  const pump = async (ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      while (context.iteration(false));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const window = new Gtk.Window();
  window.setTitle("Projector GTK smoke");
  window.setDefaultSize(320, 200);
  window.present();
  onTestFinished(() => window.destroy());
  await pump(1500);
  const surface = window.getSurface();
  expect(surface, "the window has a native surface").toBeTruthy();
  const { default: GdkWin32 } = await import("gi:GdkWin32-4.0");
  const handle = surface.getHandle();
  expect(Number(handle)).toBeGreaterThan(0);
  await os.windows.activateSurface(surface);
  const { stdout } = await runPowerShell(
    `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder t, int n); }
"@
$h = [IntPtr][int64]$env:HWND
$t = New-Object System.Text.StringBuilder 256
[void][W]::GetWindowText($h, $t, 256)
Write-Output ([W]::IsWindowVisible($h).ToString() + '|' + $t.ToString())
`,
    { env: { HWND: String(handle) } },
  );
  expect(GdkWin32).toBeTruthy();
  expect(stdout.trim()).toBe("True|Projector GTK smoke");
});
