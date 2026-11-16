import type { McpServerConfig } from "./api.ts";

/** Claude Code's own MCP server shape: a stdio process, or a remote HTTP/SSE endpoint. */
export type ClaudeMcpServer =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { type: "sse" | "http"; url: string; headers: Record<string, string> };

/**
 * Turns a Projector MCP config into the object the Agent SDK takes. The conversion belongs to
 * Claude Code: other agents keep their own transports.
 */
export function processMcpConfig(config: McpServerConfig): ClaudeMcpServer {
  if ("command" in config)
    return { type: "stdio" as const, command: config.command, args: config.args, env: config.env };
  return {
    type: config.sse ? ("sse" as const) : ("http" as const),
    url: config.url,
    headers: config.headers,
  };
}
