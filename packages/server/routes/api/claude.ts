import { claudeUsage } from "../../modules/agents-integration/claude/index.ts";
import { json, type RouteContext } from "../../modules/transport/index.ts";

export async function handleClaude({ res, method, path }: RouteContext) {
  if (path !== "/api/claude/usage" || method !== "GET") return false;
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, await claudeUsage());
  return true;
}
