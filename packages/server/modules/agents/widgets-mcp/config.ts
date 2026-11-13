import { fileURLToPath } from "node:url";

/** Name of the built-in server that exposes on-demand descriptions of special widgets. */
export const WIDGETS_MCP_SERVER = "projector-widgets";

export interface WidgetsMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The stdio MCP server every external agent can start to read the widget catalogue. */
export function widgetsMcpServer(projectId?: string): WidgetsMcpServer {
  return {
    name: WIDGETS_MCP_SERVER,
    command: process.execPath,
    args: [fileURLToPath(new URL("../../../app/widgets-mcp.ts", import.meta.url))],
    env: projectId ? { PROJECTOR_PROJECT_ID: projectId } : {},
  };
}

/** ACP passes environment variables as a list of names and values. */
export function acpWidgetsMcpServer(projectId?: string) {
  const server = widgetsMcpServer(projectId);
  return {
    name: server.name,
    command: server.command,
    args: server.args,
    env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  };
}
