import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerInfo } from "./backend.ts";

/** A stdio MCP server in the shape ACP's `session/new` takes. */
export interface AcpMcpServer {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

interface Entry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  type?: unknown;
  url?: unknown;
}

/** `${NAME}` and `${NAME:-fallback}` in a config value, as Claude Code's own `.mcp.json` allows. */
function expand(value: string): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_, name, fallback) => process.env[name] ?? fallback ?? "",
  );
}

async function readConfig(cwd: string): Promise<Record<string, Entry>> {
  try {
    const data = JSON.parse(await readFile(join(cwd, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, Entry>;
    };
    return data.mcpServers && typeof data.mcpServers === "object" ? data.mcpServers : {};
  } catch {
    return {};
  }
}

const isStdio = (entry: Entry) =>
  typeof entry.command === "string" && !!entry.command && (!entry.type || entry.type === "stdio");

/** The project's `.mcp.json` servers an ACP agent can be given (stdio ones). */
export async function projectMcpServers(cwd: string | undefined): Promise<AcpMcpServer[]> {
  if (!cwd) return [];
  return Object.entries(await readConfig(cwd)).flatMap(([name, entry]): AcpMcpServer[] => {
    if (!isStdio(entry)) return [];
    const env = entry.env && typeof entry.env === "object" ? Object.entries(entry.env) : [];
    return [
      {
        name,
        command: expand(String(entry.command)),
        args: Array.isArray(entry.args) ? entry.args.map((item) => expand(String(item))) : [],
        env: env.map(([key, value]) => ({ name: key, value: expand(String(value)) })),
      },
    ];
  });
}

/** What the chat shows for an ACP agent: which servers of the project it was given. */
export async function configuredMcpServers(cwd: string): Promise<McpServerInfo[]> {
  return Object.entries(await readConfig(cwd)).map(([name, entry]) => ({
    name,
    status: isStdio(entry) ? "передан агенту" : "не передан: нужен stdio-сервер",
    tools: 0,
  }));
}
