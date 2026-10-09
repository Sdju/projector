import type { ShortcutStatus } from "../../../launcher/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataHome } from "./directories.ts";
import { processIdentity } from "./processes.ts";

/** Names the helper understands; see `hotkeys` in helper.swift. */
export const hotkeys: Record<string, true> = { "Ctrl+Alt+Space": true, "Alt+Space": true };

const appDirectory = "projector";

export function hotkeyPath(dataDirectory = join(dataHome(), appDirectory)): string {
  return join(dataDirectory, "hotkey.json");
}

async function readState(): Promise<{ shortcut: string; active: boolean } | null> {
  try {
    const data = JSON.parse(await readFile(hotkeyPath(), "utf8"));
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

export async function shortcutAvailable(shortcut: string) {
  if (!shortcut) return { supported: true, available: true };
  if (!hotkeys[shortcut]) return { supported: false, available: false };
  const state = await readState();
  if (state?.active && state.shortcut === shortcut && (await residentAlive()))
    return { supported: true, available: true };
  try {
    const { probeHotkey } = await import(new URL("./shell.ts", import.meta.url).href);
    return { supported: true, available: await probeHotkey(shortcut) };
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

export async function desktopPid(name: string): Promise<number | undefined> {
  if (name !== "dev.projector.Launcher") return;
  try {
    const pid = Number(
      (await readFile(join(dataHome(), appDirectory, "launcher.pid"), "utf8")).trim(),
    );
    return processIdentity(pid) ? pid : undefined;
  } catch {
    return;
  }
}
