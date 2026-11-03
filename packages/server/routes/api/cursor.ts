import { cursorUsage } from "../../modules/agents-integration/cursor/index.ts";
import { json, type RouteContext } from "../../modules/transport/index.ts";

export async function handleCursor({ res, method, path }: RouteContext) {
  if (path !== "/api/cursor/usage" || method !== "GET") return false;
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, await cursorUsage());
  return true;
}
