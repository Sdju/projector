import { listProviderModels } from "../../../modules/providers/index.ts";
import { asString, json, readBody, type RouteContext } from "../../../modules/transport/index.ts";

export async function handleProvidersModels({ req, res, method, path }: RouteContext) {
  if (path !== "/api/providers/models" || method !== "POST") return false;
  const body = await readBody(req);
  res.setHeader("Cache-Control", "no-store");
  json(res, 200, {
    models: await listProviderModels({
      id: asString(body.id),
      url: asString(body.url),
      apiKey: asString(body.apiKey),
    }),
  });
  return true;
}
