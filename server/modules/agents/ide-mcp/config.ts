import { fileURLToPath } from "node:url";
import { appUrl } from "../../../../core/modules/app-paths/index.ts";
import { ideMcpTokenFile } from "../../ide/index.ts";

/** Name of the built-in server; a project's own `.mcp.json` must not silently replace it. */
export const IDE_MCP_SERVER = "projector-ide";

export interface IdeMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The stdio MCP server every external agent can start to reach the live IDE command registry. */
export function ideMcpServer(projectId: string): IdeMcpServer {
  return {
    name: IDE_MCP_SERVER,
    command: process.execPath,
    args: [fileURLToPath(new URL("./server.ts", import.meta.url))],
    env: {
      PROJECTOR_MCP_URL: process.env.PROJECTOR_URL || appUrl(),
      PROJECTOR_MCP_TOKEN_FILE: ideMcpTokenFile(),
      PROJECTOR_PROJECT_ID: projectId,
    },
  };
}

/** The Claude Agent SDK takes a server object inline with the same fields. */
export function claudeIdeMcpServer(projectId: string) {
  const server = ideMcpServer(projectId);
  return {
    type: "stdio" as const,
    command: server.command,
    args: server.args,
    env: server.env,
    // Keep the three tools in the prompt instead of deferring them behind tool search.
    alwaysLoad: true,
  };
}

/** ACP passes environment variables as a list of names and values. */
export function acpIdeMcpServer(projectId: string) {
  const server = ideMcpServer(projectId);
  return {
    name: server.name,
    command: server.command,
    args: server.args,
    env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  };
}
