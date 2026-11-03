import type { McpServerInfo } from "../../agent/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** An MCP server in the shape ACP's `session/new` takes: a process, or a remote one. */
export type AcpMcpServer =
  | { name: string; command: string; args: string[]; env: { name: string; value: string }[] }
  | { type: "http" | "sse"; name: string; url: string; headers: { name: string; value: string }[] };

/** The kinds of remote server an agent said it can use (`mcpCapabilities`). */
export interface McpSupport {
  http?: boolean;
  sse?: boolean;
}

interface Entry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  type?: unknown;
  url?: unknown;
  headers?: unknown;
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
const remoteKind = (entry: Entry): "http" | "sse" | undefined =>
  (entry.type === "http" || entry.type === "sse") && typeof entry.url === "string" && entry.url
    ? entry.type
    : undefined;

const pairs = (value: unknown) =>
  (value && typeof value === "object" ? Object.entries(value) : []).map(([name, item]) => ({
    name,
    value: expand(String(item)),
  }));

/** The project's `.mcp.json` servers this agent can be given: stdio ones, and remote ones it supports. */
export async function projectMcpServers(
  cwd: string | undefined,
  support: McpSupport = {},
): Promise<AcpMcpServer[]> {
  if (!cwd) return [];
  return Object.entries(await readConfig(cwd)).flatMap(([name, entry]): AcpMcpServer[] => {
    if (isStdio(entry))
      return [
        {
          name,
          command: expand(String(entry.command)),
          args: Array.isArray(entry.args) ? entry.args.map((item) => expand(String(item))) : [],
          env: pairs(entry.env),
        },
      ];
    const kind = remoteKind(entry);
    if (!kind || !support[kind]) return [];
    return [{ type: kind, name, url: expand(String(entry.url)), headers: pairs(entry.headers) }];
  });
}

/** What the chat shows for an ACP agent: which servers of the project it is given. */
export async function configuredMcpServers(cwd: string): Promise<McpServerInfo[]> {
  return Object.entries(await readConfig(cwd)).map(([name, entry]) => ({
    name,
    status: isStdio(entry)
      ? "передан агенту"
      : remoteKind(entry)
        ? "передан, если агент поддерживает " + remoteKind(entry)
        : "не передан: неизвестный тип сервера",
    tools: 0,
  }));
}
