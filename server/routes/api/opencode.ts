import { openCodeUsage } from "../../modules/opencode/index.ts";
import { json, type RouteContext } from "../../modules/transport/index.ts";

export async function handleOpenCode({ res, method, path }: RouteContext) {
  if (path !== "/api/opencode/usage" || method !== "GET") return false;
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, await openCodeUsage());
  return true;
}
