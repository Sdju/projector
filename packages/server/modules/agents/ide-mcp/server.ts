// The built-in IDE MCP server: three tools over the live Projector command registry, plus one that
// shows a secret without returning it. An external agent starts this process; it asks the running
// server, which asks the open Projector page, so the catalog is always the one the user has.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { AgentCommandCall } from "@projector-ai/core/modules/ide/index.ts";
import { os } from "@projector-ai/core/modules/os/index.ts";

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

/** Runs one command in the agent's project; only stdout reaches the user's panel. */
async function scriptOutput(script: string): Promise<string> {
  const command = script.trim();
  if (!command) throw new Error("Укажите скрипт, который вернёт секрет");
  if (command.length > 8_000) throw new Error("Скрипт слишком длинный");
  const result = await os.tools.runBash(command, { cwd: process.cwd() });
  if (result.terminated) throw new Error("Скрипт не завершился вовремя");
  if (result.exitCode !== 0) throw new Error("Скрипт завершился с ошибкой");
  const secret = result.stdout.replace(/[\r\n]+$/, "");
  if (!secret.trim()) throw new Error("Скрипт ничего не вернул");
  if (secret.length > 32 * 1024) throw new Error("Секрет слишком длинный");
  if (secret.includes("\0")) throw new Error("Секрет содержит недопустимый символ");
  return secret;
}

/** Posts the value to the live page; the response confirms delivery and never repeats it. */
async function pushSecret(input: {
  secret: string;
  label?: string;
  comment?: string;
}): Promise<{ shown: true; delivered: boolean; label: string | null }> {
  if (!projectId) throw new Error("MCP-сервер запущен вне чата Projector");
  if (!tokenFile) throw new Error("MCP-серверу не передан ключ Projector");
  const token = (await readFile(tokenFile, "utf8")).trim();
  const response = await fetch(`${url}/api/agent/secret-show/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      secret: input.secret,
      ...(input.label ? { label: input.label } : {}),
      ...(input.comment ? { comment: input.comment } : {}),
      projectId,
      session,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    shown?: unknown;
    delivered?: unknown;
    label?: unknown;
    error?: string;
  };
  if (!response.ok || data.shown !== true)
    throw new Error(data.error || "Не удалось показать секрет пользователю");
  return {
    shown: true,
    delivered: data.delivered === true,
    label: typeof data.label === "string" ? data.label : null,
  };
}

const server = new McpServer(
  { name: "projector-ide", version: "1" },
  {
    instructions:
      "Команды Projector. Сначала list_commands, затем describe_command для пары command и scope, затем execute_command с теми же command и scope. Изменяющие команды спрашивают подтверждение в окне Projector. show_secret показывает пользователю значение скрипта и не возвращает его тебе.",
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

server.registerTool(
  "show_secret",
  {
    description:
      "Показать пользователю секрет, который вернёт скрипт, не получая значение в ответ. Запускает shell-команду на машине пользователя, берёт её stdout и открывает панель только в окне Projector; инструмент возвращает лишь факт показа. Используйте, когда просят показать ключ, токен или пароль, а не записать его. script — команда, чей stdout и есть секрет; comment — короткое пояснение пользователю. Значение не печатайте в ответе и не угадывайте.",
    inputSchema: {
      script: z
        .string()
        .min(1)
        .max(8_000)
        .describe("Shell-команда, чей stdout — секрет; выполняется на машине пользователя"),
      label: z.string().max(200).optional().describe("Название секрета в панели"),
      comment: z.string().max(1_000).optional().describe("Пояснение агента пользователю"),
    },
  },
  async ({ script, label, comment }) => {
    try {
      const secret = await scriptOutput(script);
      return text(
        await pushSecret({
          secret,
          ...(label?.trim() ? { label: label.trim() } : {}),
          ...(comment?.trim() ? { comment: comment.trim() } : {}),
        }),
      );
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : "Скрипт не вернул секрет",
          },
        ],
      };
    }
  },
);

await server.connect(new StdioServerTransport());
