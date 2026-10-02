import { searchLauncher } from "../../../modules/launcher/index.ts";

import { json } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleLauncherSearch({
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/launcher/search" && method === "GET") {
    json(res, 200, await searchLauncher(url.searchParams.get("q") ?? ""));
    return true;
  }
  return false;
}
