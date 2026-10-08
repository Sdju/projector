// Runs outside Vitest, with the `gi:` loader: opens a real GTK window and reports what Win32 sees.
import { os } from "../../core/modules/os/index.ts";
import { runPowerShell } from "../../core/modules/os/modules/windows/ps.ts";

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
await pump(1500);
const surface = window.getSurface();
const handle = surface.getHandle();
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
console.log(JSON.stringify({ handle: Number(handle), window: stdout.trim() }));
window.destroy();
process.exit(0);
