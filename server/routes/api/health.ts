import { appUrl } from "../../../core/modules/app-paths/index.ts";

import { json } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleHealth({ res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/health" && method === "GET") {
    json(res, 200, { ok: true, app: "projector", pid: process.pid, url: appUrl() });
    return true;
  }
  return false;
}
