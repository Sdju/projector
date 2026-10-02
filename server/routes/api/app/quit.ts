import { appUrl } from "../../../../core/modules/app-paths/index.ts";

import { quitDesktop } from "../../../modules/window/index.ts";

import { json } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleAppQuit({ res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/app/quit" && method === "POST") {
    await quitDesktop(appUrl());
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 100).unref();
    return true;
  }
  return false;
}
