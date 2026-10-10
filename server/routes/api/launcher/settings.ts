import { appUrl } from "../../../../core/modules/app-paths/index.ts";

import { startTray } from "../../../modules/window/index.ts";
import {
  interfaceMode,
  preferences,
  saveInterface,
  shortcuts,
  checkShortcut,
  shortcutStatus,
  favoriteFolderPath,
  createProjectIn,
  projectPath,
  setFavoriteDirectory,
} from "../../../modules/launcher/index.ts";

import { json, readBody, asString } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleLauncherSettings({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/launcher/folders" && method === "GET") {
    json(res, 200, { folders: (await preferences()).directories });
    return true;
  }
  if (path === "/api/launcher/folders" && (method === "POST" || method === "DELETE")) {
    const body = await readBody(req);
    const folder =
      method === "POST" ? await favoriteFolderPath(asString(body.path)) : asString(body.path);
    await setFavoriteDirectory(folder, method === "POST");
    json(res, 200, { folders: (await preferences()).directories });
    return true;
  }
  if (path === "/api/launcher/folders/create" && method === "POST") {
    const body = await readBody(req);
    const { project, route } = await createProjectIn(
      await favoriteFolderPath(asString(body.folder)),
      projectPath(asString(body.name)),
    );
    json(res, 201, { project: { id: project.id, name: project.name, path: project.path }, route });
    return true;
  }
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
