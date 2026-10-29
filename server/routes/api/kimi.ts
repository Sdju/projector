import { kimiUsage } from "../../modules/agents-integration/kimi/index.ts";
import { json, type RouteContext } from "../../modules/transport/index.ts";

export async function handleKimi({ res, method, path }: RouteContext) {
  if (path !== "/api/kimi/usage" || method !== "GET") return false;
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, await kimiUsage());
  return true;
}
