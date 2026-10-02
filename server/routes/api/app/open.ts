import { appUrl } from "../../../../core/modules/app-paths/index.ts";

import { openLauncher, startTray } from "../../../modules/window/index.ts";
import { interfaceMode } from "../../../modules/launcher/index.ts";

import { json, readBody } from "../../../modules/transport/index.ts";
import { notifyLauncherShow } from "../../../modules/events/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleAppOpen({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/app/open" && method === "POST") {
    const body = await readBody(req);
    if (body.tray === true) {
      await startTray(appUrl());
      json(res, 200, { ok: true });
      return true;
    }
    const mode = await openLauncher(
      appUrl(),
      body.mode ? interfaceMode(body.mode) : undefined,
      body.toggle === true,
    );
    if (mode === "window") {
      notifyLauncherShow();
    }
    json(res, 200, { ok: true, url: appUrl(), mode });
    return true;
  }
  return false;
}
