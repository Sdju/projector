import { launchItem } from "../../../modules/launcher/index.ts";

import { json, readBody, asString } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleLauncherLaunch({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/launcher/launch" && method === "POST") {
    const body = await readBody(req);
    await launchItem(asString(body.id));
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
