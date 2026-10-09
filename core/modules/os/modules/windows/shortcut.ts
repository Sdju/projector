import type { ShortcutStatus } from "../../../launcher/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataHome } from "./directories.ts";
import { processIdentity } from "./processes.ts";
import { runPowerShell } from "./ps.ts";

export interface HotkeySpec {
  mod: number;
  vk: number;
}

/**
 * MOD_NOREPEAT plus the modifiers RegisterHotKey expects. VK_SPACE is 0x20. Win+Space is
 * absent on purpose: Windows reserves it for switching the input language.
 */
export const hotkeys: Record<string, HotkeySpec> = {
  "Ctrl+Alt+Space": { mod: 0x4003, vk: 0x20 },
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

const probeTtl = 30_000;
const probed = new Map<string, { at: number; free: Promise<boolean> }>();

/**
 * A thread-level RegisterHotKey needs no window, so the probe skips WinForms. Compiling the
 * P/Invoke stub still takes a moment: the check is async and cached per shortcut.
 */
function probe(shortcut: string, spec: HotkeySpec): Promise<boolean> {
  const cached = probed.get(shortcut);
  if (cached && Date.now() - cached.at < probeTtl) return cached.free;
  const free = runPowerShell(
    `
Add-Type -TypeDefinition 'using System;
using System.Runtime.InteropServices;
public static class ProjectorHotkeyProbe {
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}'
$ok = [ProjectorHotkeyProbe]::RegisterHotKey([IntPtr]::Zero, 1, ${spec.mod}, ${spec.vk})
if ($ok) { [void][ProjectorHotkeyProbe]::UnregisterHotKey([IntPtr]::Zero, 1) }
Write-Output $(if ($ok) { "free" } else { "busy" })
`,
    { timeout: 8000 },
  ).then(({ stdout }) => stdout.trim() === "free");
  probed.set(shortcut, { at: Date.now(), free });
  free.catch(() => probed.delete(shortcut));
  return free;
}

export async function shortcutAvailable(shortcut: string) {
  if (!shortcut) return { supported: true, available: true };
  const spec = hotkeys[shortcut];
  if (!spec) return { supported: false, available: false };
  const state = await readState();
  if (state?.active && state.shortcut === shortcut && (await residentAlive()))
    return { supported: true, available: true };
  try {
    return { supported: true, available: await probe(shortcut, spec) };
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
