import {
  mcpServerConfigs,
  readUserMcp,
  writeUserMcp,
} from "../../modules/agents/projector/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";

/** MCP servers of the Projector agent: `GET` the user's list and what the project adds, `PUT` saves the list. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/mcp",
    handler: async ({ res, url }) => {
      res.setHeader("Cache-Control", "no-store");
      const cwd = url.searchParams.get("path") || undefined;
      const servers = (await mcpServerConfigs(cwd)).map((item) => ({
        name: item.name,
        source: item.source,
        kind: "command" in item ? "stdio" : item.sse ? "sse" : "http",
      }));
      json(res, 200, { text: await readUserMcp(), servers });
    },
  },
  {
    method: "PUT",
    path: "/api/agent/mcp",
    handler: async ({ req, res }) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        await writeUserMcp(asString((await readBody(req)).text));
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
      json(res, 200, { ok: true });
    },
  },
];
