import { hidePalette } from "../../../modules/window/index.ts";

import { json } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleAppHide({ res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/app/hide" && method === "POST") {
    hidePalette();
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
