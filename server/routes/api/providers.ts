import {
  envFallbackFromProcess,
  loadPublicProviders,
  saveProviders,
} from "../../modules/providers/index.ts";
import type { OpenAIProviderWrite } from "../../modules/providers/index.ts";

import { json, readBody } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleProviders({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/providers" && method === "GET") {
    json(res, 200, await loadPublicProviders(envFallbackFromProcess()));
    return true;
  }
  if (path === "/api/providers" && method === "PUT") {
    const body = await readBody(req);
    const providers = Array.isArray(body.providers) ? body.providers : [];
    json(
      res,
      200,
      await saveProviders(
        {
          activeProviderId:
            typeof body.activeProviderId === "string" ? body.activeProviderId : null,
          providers: providers as OpenAIProviderWrite[],
        },
        envFallbackFromProcess(),
      ),
    );
    return true;
  }
  return false;
}
