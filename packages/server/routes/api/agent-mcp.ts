import {
  mcpServerConfigs,
  readUserMcp,
  writeUserMcp,
} from "../../modules/agents/projector/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody, type RouteContext } from "../../modules/transport/index.ts";

/** MCP servers of the Projector agent: `GET` the user's list and what the project adds, `PUT` saves the list. */
export async function handleAgentMcp({ req, res, method, path, url }: RouteContext) {
  if (path !== "/api/agent/mcp") return false;
  res.setHeader("Cache-Control", "no-store");
  if (method === "GET") {
    const cwd = url.searchParams.get("path") || undefined;
    const servers = (await mcpServerConfigs(cwd)).map((item) => ({
      name: item.name,
      source: item.source,
      kind: "command" in item ? "stdio" : item.sse ? "sse" : "http",
    }));
    json(res, 200, { text: await readUserMcp(), servers });
    return true;
  }
  if (method === "PUT") {
    try {
      await writeUserMcp(asString((await readBody(req)).text));
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
