// Runs outside Vitest, with the `gi:` loader: opens a real GTK window and reports what Win32 sees.
import { os } from "../../core/modules/os/index.ts";
import { runPowerShell } from "../../core/modules/os/modules/windows/ps.ts";

const { default: Gtk } = await import("gi:Gtk-4.0");
const { default: GLib } = await import("gi:GLib-2.0");
await import("gi:GdkWin32-4.0"); // before any surface exists, so it is wrapped as a Win32Surface
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
await pump(300);
const { stdout } = await runPowerShell(
  `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT point, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct MONITORINFO {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
  }
  public static string Offset(IntPtr h) {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {}
    RECT rect; POINT point;
    if (!GetWindowRect(h, out rect) || !GetCursorPos(out point)) return "0|0";
    var info = new MONITORINFO();
    info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    var monitor = MonitorFromPoint(point, 2);
    if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref info)) return "0|0";
    int dx = (rect.Left + rect.Right) / 2 - (info.rcWork.Left + info.rcWork.Right) / 2;
    int dy = (rect.Top + rect.Bottom) / 2 - (info.rcWork.Top + info.rcWork.Bottom) / 2;
    return dx.ToString() + "|" + dy.ToString();
  }
}
"@
$h = [IntPtr][int64]$env:HWND
$t = New-Object System.Text.StringBuilder 256
[void][W]::GetWindowText($h, $t, 256)
$offset = [W]::Offset($h)
Write-Output ([W]::IsWindowVisible($h).ToString() + '|' + $t.ToString() + '|' + $offset)
`,
  { env: { HWND: String(handle) } },
);
console.log(JSON.stringify({ handle: Number(handle), window: stdout.trim() }));
window.destroy();
process.exit(0);
