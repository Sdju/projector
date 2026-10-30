import { fileURLToPath } from "node:url";

/** Name of the built-in server that exposes on-demand descriptions of special widgets. */
export const WIDGETS_MCP_SERVER = "projector-widgets";

export interface WidgetsMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The stdio MCP server every external agent can start to read the special-widget catalogue. */
export function widgetsMcpServer(): WidgetsMcpServer {
  return {
    name: WIDGETS_MCP_SERVER,
    command: process.execPath,
    args: [fileURLToPath(new URL("../../../app/widgets-mcp.ts", import.meta.url))],
    env: {},
  };
}

/** The Claude Agent SDK takes a server object inline with the same fields. */
export function claudeWidgetsMcpServer() {
  const server = widgetsMcpServer();
  return {
    type: "stdio" as const,
    command: server.command,
    args: server.args,
    env: server.env,
    // The one tool must be visible immediately instead of hiding behind tool search.
    alwaysLoad: true,
  };
}

/** ACP passes environment variables as a list of names and values. */
export function acpWidgetsMcpServer() {
  const server = widgetsMcpServer();
  return {
    name: server.name,
    command: server.command,
    args: server.args,
    env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  };
}
