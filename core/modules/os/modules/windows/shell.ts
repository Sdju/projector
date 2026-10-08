import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hotkeyPath } from "./shortcut.ts";
import { spawnPowerShell } from "./ps.ts";

const iconPath = fileURLToPath(new URL("../../../../../resources/icons/64.png", import.meta.url));

const host = String.raw`
try { [Console]::TreatControlCAsInput = $true } catch {}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
public delegate void HotkeyHandler();
public static class ProjectorHotkey {
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
public class ProjectorCommands {
  readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
  public void Start() {
    var thread = new Thread(() => {
      try {
        var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = reader.ReadLine()) != null) queue.Enqueue(line);
        queue.Enqueue("quit");
      } catch {}
    });
    thread.IsBackground = true;
    thread.Start();
  }
  public string[] Drain() {
    var lines = new List<string>();
    string line;
    while (queue.TryDequeue(out line)) lines.Add(line);
    return lines.ToArray();
  }
}
public class ProjectorTrayForm : Form {
  public HotkeyHandler Hotkey;
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x0312 && Hotkey != null) Hotkey();
    base.WndProc(ref m);
  }
}' -ReferencedAssemblies System.Windows.Forms
function Emit([string]$text) {
  [Console]::Out.WriteLine($text)
  [Console]::Out.Flush()
}
$mods = @{
  "Ctrl+Alt+Space" = 0x4003
  "Super+Space" = 0x4008
  "Alt+Space" = 0x4001
}
$script:form = New-Object ProjectorTrayForm
$form.ShowInTaskbar = $false
$form.Opacity = 0
$form.Hotkey = { Emit "hotkey" }
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = "Projector"
try {
  $bitmap = New-Object System.Drawing.Bitmap $env:PROJECTOR_TRAY_ICON
  $notify.Icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
} catch {
  $notify.Icon = [System.Drawing.SystemIcons]::Application
}
$notify.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
function Add-Item([string]$label, [string]$action) {
  $item = $menu.Items.Add($label)
  $null = $item.Add_Click({ Emit $action }.GetNewClosure())
}
Add-Item "Открыть поиск" "activate"
Add-Item "Настройки" "settings"
$null = $menu.Items.Add("-")
Add-Item "Перезапустить" "restart"
Add-Item "Выйти из Projector" "quit"
$notify.ContextMenuStrip = $menu
$notify.Add_MouseClick({
  param($sender, $mouse)
  if ($mouse.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Emit "activate" }
})
$script:hotkeyId = 1
function Set-Hotkey([string]$name) {
  [void][ProjectorHotkey]::UnregisterHotKey($form.Handle, $script:hotkeyId)
  if (-not $name) { Emit "cleared"; return }
  $mod = $mods[$name]
  if (-not $mod) { Emit "busy"; return }
  $ok = [ProjectorHotkey]::RegisterHotKey($form.Handle, $script:hotkeyId, [uint32]$mod, [uint32]0x20)
  Emit $(if ($ok) { "registered" } else { "busy" })
}
$script:commands = New-Object ProjectorCommands
$script:commands.Start()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
$timer.Add_Tick({
  $lines = $script:commands.Drain()
  if ($null -eq $lines) { return }
  foreach ($line in @($lines)) {
    if ($line -eq "quit") { $script:form.Close(); return }
    if ($line.StartsWith("shortcut ")) { Set-Hotkey $line.Substring(9).Trim() }
  }
})
$form.Add_FormClosing({
  $timer.Stop()
  [void][ProjectorHotkey]::UnregisterHotKey($form.Handle, $script:hotkeyId)
  $notify.Visible = $false
  $notify.Dispose()
})
$form.Add_Shown({
  $form.Hide()
  $timer.Start()
  Emit "ready"
})
[System.Windows.Forms.Application]::Run($form)
`;

export interface DesktopShell {
  configure(shortcut: string): Promise<"registered" | "cleared" | "busy">;
  stop(): Promise<void>;
}

const idle: DesktopShell = {
  configure() {
    return Promise.reject(new Error("Трей недоступен"));
  },
  stop: async () => undefined,
};

/** Win32 tray icon and global hotkey. Lives beside the GTK palette and talks over stdin. */
export async function startDesktopShell(
  dataDirectory: string,
  handlers: {
    onActivate: () => void;
    onHotkey: () => void;
    onSettings: () => void;
    onRestart: () => void;
    onQuit: () => void;
  },
): Promise<DesktopShell> {
  try {
    return await launch(dataDirectory, handlers);
  } catch (error) {
    console.error("Трей:", error instanceof Error ? error.message : error);
    await remember(dataDirectory, "", false);
    return idle;
  }
}

async function launch(
  dataDirectory: string,
  handlers: {
    onActivate: () => void;
    onHotkey: () => void;
    onSettings: () => void;
    onRestart: () => void;
    onQuit: () => void;
  },
): Promise<DesktopShell> {
  const child = spawnPowerShell(host, { sta: true, env: { PROJECTOR_TRAY_ICON: iconPath } });
  let stopped = false;
  let requested = "";
  let pending: ((result: "registered" | "cleared" | "busy") => void) | undefined;
  const failPending = () => {
    pending?.("busy");
    pending = undefined;
  };
  child.on("error", (error) => console.error("Трей:", error.message));
  child.once("exit", () => failPending());
  process.once("exit", () => {
    if (!stopped) child.kill();
  });
  const stderr = child.stderr;
  if (stderr) {
    stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error("Трей:", text);
    });
  }
  const input = child.stdin;
  const output = child.stdout;
  if (!input || !output) throw new Error("Не удалось запустить трей");
  const lines = createInterface({ input: output });
  lines.on("line", (line) => {
    const text = line.trim();
    if (text === "ready") return;
    if (text === "registered" || text === "cleared" || text === "busy") {
      const resolve = pending;
      pending = undefined;
      const shortcut = text === "registered" ? requested : "";
      void remember(dataDirectory, shortcut, text === "registered").finally(() => resolve?.(text));
      return;
    }
    if (text === "hotkey") handlers.onHotkey();
    else if (text === "activate") handlers.onActivate();
    else if (text === "settings") handlers.onSettings();
    else if (text === "restart") handlers.onRestart();
    else if (text === "quit") handlers.onQuit();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Трей не ответил"));
    }, 8000);
    const onLine = (line: string) => {
      if (line.trim() !== "ready") return;
      clearTimeout(timer);
      lines.off("line", onLine);
      resolve();
    };
    lines.on("line", onLine);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Трей завершился (${code ?? signal ?? "?"})`));
    });
  });
  let chain: Promise<unknown> = Promise.resolve();
  return {
    configure(shortcut: string) {
      const task = chain.then(
        () =>
          new Promise<"registered" | "cleared" | "busy">((resolve) => {
            requested = shortcut;
            const timer = setTimeout(() => {
              pending = undefined;
              resolve("busy");
            }, 3000);
            pending = (result) => {
              clearTimeout(timer);
              resolve(result);
            };
            input.write(`shortcut ${shortcut}\n`);
          }),
      );
      chain = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      failPending();
      input.write("quit\n");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await remember(dataDirectory, "", false);
    },
  };
}

async function remember(dataDirectory: string, shortcut: string, active: boolean) {
  await mkdir(dirname(hotkeyPath(dataDirectory)), { recursive: true });
  await writeFile(hotkeyPath(dataDirectory), JSON.stringify({ shortcut, active }));
}
