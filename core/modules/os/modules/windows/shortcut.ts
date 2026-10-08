import type { ShortcutStatus } from "../../../launcher/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataHome } from "./directories.ts";
import { processIdentity } from "./processes.ts";
import { runPowerShellSync } from "./ps.ts";

/** MOD_NOREPEAT plus the modifiers RegisterHotKey expects. VK_SPACE is 0x20. */
const hotkeys: Record<string, { mod: number; vk: number }> = {
  "Ctrl+Alt+Space": { mod: 0x4003, vk: 0x20 },
  "Super+Space": { mod: 0x4008, vk: 0x20 },
  "Alt+Space": { mod: 0x4001, vk: 0x20 },
};

const appDirectory = "projector";

export function hotkeyPath(dataDirectory = join(dataHome(), appDirectory)): string {
  return join(dataDirectory, "hotkey.json");
}

interface HotkeyState {
  shortcut: string;
  active: boolean;
}

async function readState(dataDirectory?: string): Promise<HotkeyState | null> {
  try {
    const data = JSON.parse(await readFile(hotkeyPath(dataDirectory), "utf8")) as HotkeyState;
    return typeof data.shortcut === "string" && typeof data.active === "boolean" ? data : null;
  } catch {
    return null;
  }
}

async function residentAlive(): Promise<boolean> {
  try {
    const pid = Number(
      (await readFile(join(dataHome(), appDirectory, "launcher.pid"), "utf8")).trim(),
    );
    return processIdentity(pid) !== null;
  } catch {
    return false;
  }
}

function probe(spec: { mod: number; vk: number }): boolean {
  const stdout = runPowerShellSync(
    `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System;
using System.Runtime.InteropServices;
public static class ProjectorHotkeyProbe {
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}'
$form = New-Object System.Windows.Forms.Form
$form.ShowInTaskbar = $false
$null = $form.Handle
$ok = [ProjectorHotkeyProbe]::RegisterHotKey($form.Handle, 1, ${spec.mod}, ${spec.vk})
if ($ok) { [void][ProjectorHotkeyProbe]::UnregisterHotKey($form.Handle, 1) }
$form.Dispose()
Write-Output $(if ($ok) { "free" } else { "busy" })
`,
    { sta: true, timeout: 8000 },
  );
  return stdout.trim() === "free";
}

export async function shortcutAvailable(shortcut: string) {
  if (!shortcut) return { supported: true, available: true };
  const spec = hotkeys[shortcut];
  if (!spec) return { supported: false, available: false };
  const state = await readState();
  if (state?.active && state.shortcut === shortcut && (await residentAlive()))
    return { supported: true, available: true };
  try {
    return { supported: true, available: probe(spec) };
  } catch {
    return { supported: false, available: false };
  }
}

export async function shortcutStatus(): Promise<ShortcutStatus> {
  const state = await readState();
  if (!state?.active || !(await residentAlive()))
    return { supported: true, active: false, shortcut: "" };
  return { supported: true, active: true, shortcut: state.shortcut };
}
