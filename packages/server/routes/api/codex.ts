import { codexUsage } from "../../modules/agents-integration/codex/index.ts";
import { json, type RouteContext } from "../../modules/transport/index.ts";

export async function handleCodex({ res, method, path }: RouteContext) {
  if (path !== "/api/codex/usage" || method !== "GET") return false;
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, await codexUsage());
  return true;
}
