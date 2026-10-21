import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "../../../../core/modules/app-paths/index.ts";

/** An MCP server the agent can use: a process it starts, or a remote one. */
export type McpServerConfig =
  | {
      name: string;
      source: McpSource;
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | { name: string; source: McpSource; url: string; sse: boolean; headers: Record<string, string> };

/** `user` servers are the user's own choice; `project` ones come from a repository and are asked about. */
export type McpSource = "user" | "project";

interface Entry {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  type?: unknown;
  url?: unknown;
  headers?: unknown;
  disabled?: unknown;
}

/** `${NAME}` and `${NAME:-fallback}` in a config value, as Claude Code's own `.mcp.json` allows. */
function expand(value: string): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_, name, fallback) => process.env[name] ?? fallback ?? "",
  );
}

export const userMcpFile = () => join(dataDir(), "agent", "mcp.json");

async function readEntries(path: string): Promise<Record<string, Entry>> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as {
      mcpServers?: Record<string, Entry>;
    };
    return data.mcpServers && typeof data.mcpServers === "object" ? data.mcpServers : {};
  } catch {
    return {};
  }
}

const pairs = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    (value && typeof value === "object" ? Object.entries(value) : []).map(([name, item]) => [
      name,
      expand(String(item)),
    ]),
  );

function toConfig(name: string, source: McpSource, entry: Entry): McpServerConfig | undefined {
  if (entry.disabled === true) return undefined;
  if (typeof entry.command === "string" && entry.command && (!entry.type || entry.type === "stdio"))
    return {
      name,
      source,
      command: expand(entry.command),
      args: Array.isArray(entry.args) ? entry.args.map((item) => expand(String(item))) : [],
      env: pairs(entry.env),
    };
  if ((entry.type === "http" || entry.type === "sse") && typeof entry.url === "string" && entry.url)
    return {
      name,
      source,
      url: expand(entry.url),
      sse: entry.type === "sse",
      headers: pairs(entry.headers),
    };
  return undefined;
}

/** The user's servers and the project's `.mcp.json`; a project server of the same name wins nothing over the user's. */
export async function mcpServerConfigs(cwd?: string): Promise<McpServerConfig[]> {
  const user = await readEntries(userMcpFile());
  const project = cwd ? await readEntries(join(cwd, ".mcp.json")) : {};
  return [
    ...Object.entries(user).map(([name, entry]) => toConfig(name, "user", entry)),
    ...Object.entries(project)
      .filter(([name]) => !(name in user))
      .map(([name, entry]) => toConfig(name, "project", entry)),
  ].filter((item): item is McpServerConfig => !!item);
}

/** The user's server list as written, for the settings page; empty when there is none yet. */
export async function readUserMcp(): Promise<string> {
  try {
    return await readFile(userMcpFile(), "utf8");
  } catch {
    return "";
  }
}

/** Saves the user's server list after checking it is `{ "mcpServers": { ... } }`; empty text removes it. */
export async function writeUserMcp(text: string): Promise<void> {
  const path = userMcpFile();
  if (!text.trim()) return void (await rm(path, { force: true }));
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Не JSON: ${(error as Error).message}`);
  }
  const servers = (data as { mcpServers?: unknown } | null)?.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers))
    throw new Error('Нужен объект вида { "mcpServers": { "имя": { … } } }');
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text.trim() + "\n", { mode: 0o600 });
  await rename(temporary, path);
}
