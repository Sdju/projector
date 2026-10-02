import { envFallbackFromProcess, setActiveProvider } from "../../../modules/providers/index.ts";

import { json, readBody, asString } from "../../../modules/transport/index.ts";

import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleProvidersActive({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/providers/active" && method === "PATCH") {
    const body = await readBody(req);
    json(res, 200, await setActiveProvider(asString(body.id), envFallbackFromProcess()));
    return true;
  }
  return false;
}
