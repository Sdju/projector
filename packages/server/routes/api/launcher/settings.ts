import { appUrl } from "@projector-ai/core/modules/app-paths/index.ts";

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

import {
  json,
  readBody,
  asString,
  type RouteDefinition,
} from "../../../modules/transport/index.ts";

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/launcher/folders",
    handler: async ({ res }) => {
      json(res, 200, { folders: (await preferences()).directories });
    },
  },
  {
    method: ["POST", "DELETE"],
    path: "/api/launcher/folders",
    handler: async ({ req, res, method }) => {
      const body = await readBody(req);
      const folder =
        method === "POST" ? await favoriteFolderPath(asString(body.path)) : asString(body.path);
      await setFavoriteDirectory(folder, method === "POST");
      json(res, 200, { folders: (await preferences()).directories });
    },
  },
  {
    method: "POST",
    path: "/api/launcher/folders/create",
    handler: async ({ req, res }) => {
      const body = await readBody(req);
      const { project, route } = await createProjectIn(
        await favoriteFolderPath(asString(body.folder)),
        projectPath(asString(body.name)),
      );
      json(res, 201, {
        project: { id: project.id, name: project.name, path: project.path },
        route,
      });
    },
  },
  {
    method: "GET",
    path: "/api/launcher/settings",
    handler: async ({ res }) => {
      const prefs = await preferences();
      json(res, 200, {
        mode: prefs.mode,
        shortcut: prefs.shortcut,
        hotkey: await shortcutStatus(),
      });
    },
  },
  {
    method: "PUT",
    path: "/api/launcher/settings",
    handler: async ({ req, res }) => {
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
    },
  },
];
