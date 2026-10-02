import { appUrl } from "../../../../core/modules/app-paths/index.ts";

import { startTray } from "../../../modules/window/index.ts";
import {
  interfaceMode,
  preferences,
  saveInterface,
  shortcuts,
  checkShortcut,
  shortcutStatus,
} from "../../../modules/launcher/index.ts";

import { json, readBody, asString } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleLauncherSettings({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/launcher/settings" && method === "GET") {
    const prefs = await preferences();
    json(res, 200, {
      mode: prefs.mode,
      shortcut: prefs.shortcut,
      hotkey: await shortcutStatus(),
    });
    return true;
  }
  if (path === "/api/launcher/settings" && method === "PUT") {
    const body = await readBody(req);
    if (!["native", "window", "browser"].includes(asString(body.mode)))
      throw new Error("Неизвестный режим интерфейса");
    const mode = interfaceMode(body.mode);
    const shortcut = body.shortcut === undefined ? undefined : asString(body.shortcut);
    if (shortcut !== undefined && !shortcuts.includes(shortcut))
      throw new Error("Неизвестное сочетание клавиш");
    if (shortcut !== undefined) await checkShortcut(shortcut);
    await saveInterface(mode, shortcut);
    // Update an existing resident process without showing its palette.
    if (shortcut !== undefined) await startTray(appUrl()).catch(() => undefined);
    const prefs = await preferences();
    json(res, 200, { mode, shortcut: prefs.shortcut, hotkey: await shortcutStatus() });
    return true;
  }
  return false;
}
