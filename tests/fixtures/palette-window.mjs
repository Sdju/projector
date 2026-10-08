// Runs outside Vitest, with the `gi:` and `.vue` loaders: shows the real palette and photographs it.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runPowerShell } from "../../core/modules/os/modules/windows/ps.ts";

await import("gi:GdkWin32-4.0");
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
const { Palette } = await import("../../native/modules/desktop/palette.ts");
const palette = new Palette("http://127.0.0.1:9", () => null);
await palette.show();
await pump(3500);
const directory = process.env.PROJECTOR_SHOT_DIR;
if (directory) mkdirSync(directory, { recursive: true });
const { stdout } = await runPowerShell(
  `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class P {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
"@
$process = Get-Process -Id ([int]$env:TARGET_PID)
$h = $process.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Output '{"found":false}'; exit 0 }
$r = New-Object P+RECT
[void][P]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $hgt = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$colors = @{}
for ($x = 0; $x -lt $w; $x += 7) { for ($y = 0; $y -lt $hgt; $y += 7) { $colors[$bmp.GetPixel($x, $y).ToArgb()] = 1 } }
if ($env:SHOT_FILE) { $bmp.Save($env:SHOT_FILE, [System.Drawing.Imaging.ImageFormat]::Png) }
Write-Output ('{"found":true,"visible":' + ([P]::IsWindowVisible($h)).ToString().ToLower() + ',"title":"' + $process.MainWindowTitle + '","width":' + $w + ',"height":' + $hgt + ',"colors":' + $colors.Count + '}')
`,
  {
    env: {
      TARGET_PID: String(process.pid),
      SHOT_FILE: directory ? join(directory, "palette.png") : "",
    },
    timeout: 30000,
  },
);
console.log(stdout.trim().split(/\r?\n/).at(-1));
palette.dispose();
process.exit(0);
