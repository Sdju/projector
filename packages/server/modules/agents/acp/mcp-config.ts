import type { McpServerInfo } from "../../agent/index.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mcpServerConfigs, type McpServerConfig } from "../../agent-mcp/index.ts";

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

/** A parsed config in the shape ACP takes; a remote kind the agent lacks is left out. */
function acpServer(config: McpServerConfig, support: McpSupport): AcpMcpServer[] {
  if ("command" in config)
    return [
      {
        name: config.name,
        command: config.command,
        args: config.args,
        env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
      },
    ];
  if (config.sse ? !support.sse : !support.http) return [];
  return [
    {
      type: config.sse ? "sse" : "http",
      name: config.name,
      url: config.url,
      headers: Object.entries(config.headers).map(([name, value]) => ({ name, value })),
    },
  ];
}

/** The user's own servers a role names; the project's are passed separately from `.mcp.json`. */
export async function userMcpServers(
  cwd: string | undefined,
  names: readonly string[],
  support: McpSupport = {},
): Promise<AcpMcpServer[]> {
  if (!names.length) return [];
  return (await mcpServerConfigs(cwd))
    .filter((config) => config.source === "user" && names.includes(config.name))
    .flatMap((config) => acpServer(config, support));
}

/**
 * The MCP servers of a session: the project's own, plus the built-in IDE and widget servers when
 * their features are on. Only those additions may hide a same-named project server; with the
 * feature off the user's `projector-ide` or `projector-widgets` from `.mcp.json` is passed as is.
 */
export async function sessionMcpServers(
  cwd: string | undefined,
  support: McpSupport,
  extra: AcpMcpServer[],
  only?: readonly string[],
): Promise<AcpMcpServer[]> {
  const project = only
    ? (await projectMcpServers(cwd, support)).filter((server) => only.includes(server.name))
    : await projectMcpServers(cwd, support);
  if (!extra.length) return project;
  const names = new Set(extra.map((server) => server.name));
  return [...project.filter((server) => !names.has(server.name)), ...extra];
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
