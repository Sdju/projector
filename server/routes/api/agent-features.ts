import { featureSettings, setFeatureAgent } from "../../modules/agent-features/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody, type RouteContext } from "../../modules/transport/index.ts";

/** Optional abilities of the chat agents: which feature is on for which agent. */
export async function handleAgentFeatures({ req, res, method, path }: RouteContext) {
  if (path !== "/api/agent/features") return false;
  res.setHeader("Cache-Control", "no-store");
  if (method === "GET") {
    json(res, 200, await featureSettings());
    return true;
  }
  if (method === "PUT") {
    const body = await readBody(req);
    const feature = asString(body.feature);
    const agent = asString(body.agent);
    if (!feature) throw new HttpError(400, "Укажите feature");
    if (!agent) throw new HttpError(400, "Укажите agent");
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled должен быть boolean");
    try {
      json(res, 200, await setFeatureAgent(feature, agent, body.enabled));
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    return true;
  }
  return false;
}
