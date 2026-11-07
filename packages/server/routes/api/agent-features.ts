import { featureSettings, setFeatureAgent } from "../../modules/agent-features/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";

/** Optional abilities of the chat agents: which feature is on for which agent. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/features",
    handler: async ({ res }) => {
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await featureSettings());
    },
  },
  {
    method: "PUT",
    path: "/api/agent/features",
    handler: async ({ req, res }) => {
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const feature = asString(body.feature);
      const agent = asString(body.agent);
      if (!feature) throw new HttpError(400, "Укажите feature");
      if (!agent) throw new HttpError(400, "Укажите agent");
      if (typeof body.enabled !== "boolean")
        throw new HttpError(400, "enabled должен быть boolean");
      try {
        json(res, 200, await setFeatureAgent(feature, agent, body.enabled));
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    },
  },
];
