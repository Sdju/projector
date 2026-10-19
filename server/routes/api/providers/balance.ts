import { providerBalance } from "../../../modules/providers/index.ts";
import { json, type RouteContext } from "../../../modules/transport/index.ts";

export async function handleProvidersBalance({ res, url, method, path }: RouteContext) {
  if (path !== "/api/providers/balance" || method !== "GET") return false;
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, await providerBalance(url.searchParams.get("id")?.trim() || undefined));
  return true;
}
