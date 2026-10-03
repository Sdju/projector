import { appUrl } from "../../../../core/modules/app-paths/index.ts";

import { HttpError } from "../../../modules/http/index.ts";
import { restartProjector } from "../../../modules/restart/index.ts";

import { isLocalRequest } from "../../../modules/access/index.ts";

import { json } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleAppRestart({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/app/restart" && method === "POST") {
    if (!isLocalRequest(req))
      throw new HttpError(403, "Перезапуск доступен только с локальной машины");
    await restartProjector(appUrl());
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 100).unref();
    return true;
  }
  return false;
}
