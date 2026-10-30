// The built-in IDE MCP server: three tools over the live Projector command registry, not one tool
// per feature. An external agent starts this process; it asks the running server, which asks the
// open Projector page, so the catalog is always the one the user actually has.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { AgentCommandCall } from "../../../../core/modules/ide/index.ts";

const url = process.env.PROJECTOR_MCP_URL || "http://localhost:4177";
const tokenFile = process.env.PROJECTOR_MCP_TOKEN_FILE;
const projectId = process.env.PROJECTOR_PROJECT_ID;
/** This MCP process keeps one page owner for its whole life, so its tools see one workbench. */
const session = randomUUID();
const RESULT_CHARS = 60_000;

/** Commands described in this MCP session: execution is refused until its pair was described. */
const described = new Set<string>();

async function bridge(request: AgentCommandCall): Promise<unknown> {
  if (!projectId) throw new Error("MCP-сервер запущен вне чата Projector");
  if (!tokenFile) throw new Error("MCP-серверу не передан ключ Projector");
  const token = (await readFile(tokenFile, "utf8")).trim();
  const response = await fetch(`${url}/api/ide/command-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ projectId, session, request }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = (await response.json().catch(() => ({}))) as { output?: unknown; error?: string };
  if (!response.ok) throw new Error(data.error || "Projector недоступен");
  return data.output;
}

function text(value: unknown) {
  const body = JSON.stringify(value ?? null, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text: body.length > RESULT_CHARS ? `${body.slice(0, RESULT_CHARS)}\n…обрезано` : body,
      },
    ],
  };
}

const server = new McpServer(
  { name: "projector-ide", version: "1" },
  {
    instructions:
      "Команды Projector. Сначала list_commands, затем describe_command для пары command и scope, затем execute_command с теми же command и scope. Изменяющие команды спрашивают подтверждение в окне Projector.",
  },
);

server.registerTool(
  "list_commands",
  {
    description:
      "Найти существующие команды Projector и их области (scope). Пустой query возвращает весь каталог текущего проекта.",
    inputSchema: { query: z.string().optional() },
  },
  async ({ query }) => text(await bridge({ operation: "list", ...(query ? { query } : {}) })),
);

server.registerTool(
  "describe_command",
  {
    description: "Получить описание, аргументы и контекст команды перед вызовом.",
    inputSchema: { command: z.string(), scope: z.string() },
  },
  async ({ command, scope }) => {
    const result = await bridge({ operation: "describe", command, scope });
    described.add(`${scope}\n${command}`);
    return text(result);
  },
);

server.registerTool(
  "execute_command",
  {
    description:
      "Вызвать команду Projector в явной области scope. Только после describe_command для этой же пары command и scope: без него вызов отклоняется. Порядок всегда такой: list_commands, describe_command, execute_command.",
    inputSchema: {
      command: z.string(),
      scope: z.string(),
      args: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async ({ command, scope, args }) => {
    if (!described.has(`${scope}\n${command}`))
      throw new Error("Сначала вызовите describe_command для этой пары command и scope");
    return text(await bridge({ operation: "execute", command, scope, ...(args ? { args } : {}) }));
  },
);

await server.connect(new StdioServerTransport());
