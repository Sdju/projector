import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { os } from "@projector/core/modules/os/index.ts";
import type { AgentTaskPatch } from "@projector/core/modules/agent-task/index.ts";
import type { AgentRoleSnapshot } from "@projector/core/modules/agent-role/index.ts";
import type { AgentEmitter, AgentSelection } from "../../agent/index.ts";
import { readAgentRole } from "../../agent-roles/index.ts";
import {
  createQwenOpenAI,
  envFallbackFromProcess,
  resolveOpenAIProvider,
  thinkingBody,
} from "../../providers/index.ts";
import { isForbiddenPath } from "./projector-guard.ts";

/** A task is research, not an endless agent: a few reads and one answer are enough. */
export const TASK_LIMITS = { steps: 6, seconds: 90, text: 80_000, tokens: 4_000 } as const;

const TASK_PROMPT = `Ты Projector Task — read-only исследователь внутри проекта. Тебе дают описание и задачу; изучи проект и верни короткую сводку для основного агента.

Ты не меняешь файлы, не запускаешь команды, не пишешь в сеть и не просишь разрешений. У тебя есть только чтение: read_file, list_directory и search. Не выдумывай содержимое файлов: если нужного нет в проекте, скажи об этом.

Ответь по-русски, структурно и по делу: что нашёл, где именно (пути и строки), что важно для задачи и какие остались неясности. Не пересказывай процесс чтения.`;

export interface ProjectorTaskRequest {
  /** The tool call id, used as the task id in the chat. */
  id: string;
  description: string;
  prompt: string;
  /** A chat role to run the task as; `projector` only. */
  role?: string;
  cwd?: string;
  projectId?: string;
  signal?: AbortSignal;
  /** The chat's own selection, used when the task has no role of its own. */
  selection?: AgentSelection;
  /** The parent chat's role; inherited when the tool got no role id. */
  parentRole?: AgentRoleSnapshot;
  emit: AgentEmitter;
}

async function taskRole(
  request: ProjectorTaskRequest,
): Promise<{ name?: string; selection: AgentSelection }> {
  const id = request.role?.trim();
  if (id) {
    const role = await readAgentRole(id, request.projectId);
    if (!role) throw new Error(`Неизвестная или недоверенная роль: ${id}`);
    if (role.kind !== "chat") throw new Error("Служебная роль не подходит для task");
    if (role.agent !== "projector")
      throw new Error(`task работает на Projector, а роль «${role.name}» — на ${role.agent}`);
    return { name: role.name, selection: role.selection };
  }
  const inherited = request.parentRole;
  return {
    ...(inherited?.name ? { name: inherited.name } : {}),
    selection: inherited?.selection ?? {},
  };
}

async function inside(
  cwd: string | undefined,
  path: string,
): Promise<{ root: string; full: string }> {
  const root = await realpath(resolve(cwd ?? process.cwd()));
  const full = await realpath(resolve(root, path || "."));
  const rel = relative(root, full) || ".";
  if (rel.split(/[\\/]/).includes(".git") || isForbiddenPath(rel, root))
    throw new Error("Путь вне проекта или похож на секрет");
  return { root, full };
}

function clip(text: string, max = TASK_LIMITS.text): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: `${text.slice(0, max)}\n…`, truncated: true }
    : { text, truncated: false };
}

function taskTools(cwd: string | undefined, signal: AbortSignal | undefined) {
  return {
    read_file: tool({
      description:
        "Прочитать текстовый файл проекта. Путь относительный; секреты и выход за проект запрещены.",
      inputSchema: z.object({
        path: z.string().describe("Путь к файлу относительно проекта"),
      }),
      execute: async ({ path }) => {
        const { full } = await inside(cwd, path);
        const info = await stat(full);
        if (info.size > 2_000_000) throw new Error("Файл слишком большой для task");
        const text = await readFile(full, "utf8");
        return { path, ...clip(text) };
      },
    }),
    list_directory: tool({
      description: "Показать содержимое папки проекта: имена файлов и папок. Секреты пропускаются.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe("Путь к папке относительно проекта; по умолчанию корень"),
      }),
      execute: async ({ path }) => {
        const { root, full } = await inside(cwd, path ?? ".");
        const entries = await readdir(full, { withFileTypes: true });
        const items = entries
          .map((entry) => {
            const child = join(full, entry.name);
            const rel = relative(root, child) || entry.name;
            return {
              name: entry.name,
              path: rel,
              type: entry.isDirectory() ? "dir" : "file",
              forbidden:
                entry.isSymbolicLink() ||
                rel.split(/[\\/]/).includes(".git") ||
                isForbiddenPath(rel, root),
            };
          })
          .filter((item) => !item.forbidden)
          .sort(
            (a, b) =>
              Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name),
          )
          .slice(0, 200)
          .map(({ forbidden: _forbidden, ...item }) => item);
        return { path: relative(root, full) || ".", items };
      },
    }),
    search: tool({
      description:
        "Найти текст в проекте через ripgrep. Возвращает строки с путями и номерами; секреты исключены.",
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        path: z
          .string()
          .optional()
          .describe("Папка или файл относительно проекта; по умолчанию корень"),
      }),
      execute: async ({ query, path }) => {
        const { root, full } = await inside(cwd, path ?? ".");
        const target = relative(root, full) || ".";
        const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
        const command = [
          "rg",
          "--no-config",
          "--line-number",
          "--no-heading",
          "--color",
          "never",
          "--max-count",
          "200",
          "--glob",
          quote("!**/.env*"),
          "--glob",
          quote("!**/*.pem"),
          "--glob",
          quote("!**/*.key"),
          "--glob",
          quote("!**/.ssh/**"),
          "-e",
          quote(query),
          quote(target),
        ].join(" ");
        const result = await os.tools.runBash(command, {
          cwd: root,
          signal,
        });
        return {
          query,
          path: target,
          exitCode: result.exitCode,
          ...clip(result.stdout || result.stderr),
        };
      },
    }),
  };
}

export interface ProjectorTaskResult {
  text: string;
  role?: string;
}

/** Binds the current chat's model and role to the `task` tool without leaking run options into it. */
export function taskRunnerFor(options: {
  cwd?: string;
  projectId?: string;
  selection?: AgentSelection;
  role?: AgentRoleSnapshot;
  signal?: AbortSignal;
  emit: AgentEmitter;
}) {
  return (request: { id: string; description: string; prompt: string; role?: string }) =>
    runProjectorTask({
      ...request,
      cwd: options.cwd,
      projectId: options.projectId,
      selection: options.selection,
      parentRole: options.role,
      signal: options.signal,
      emit: options.emit,
    });
}

/** One read-only subagent call: its own model context, reading tools and a summary back to the parent. */
export async function runProjectorTask(
  request: ProjectorTaskRequest,
): Promise<ProjectorTaskResult> {
  const startedAt = Date.now();
  const patch = (value: AgentTaskPatch) => request.emit("task", value);
  const role = await taskRole(request);
  const selection = { ...request.selection, ...role.selection };
  const [providerId, ...rest] = (selection.provider || "").split(":");
  const resolved = await resolveOpenAIProvider({
    providerId,
    model: rest.join(":"),
    fallback: envFallbackFromProcess(),
  });
  const provider = createQwenOpenAI({
    openaiUrl: resolved.url,
    openaiApiKey: resolved.apiKey,
  });
  const model = provider.chatModel(resolved.model);
  const style = resolved.thinking === false ? "none" : resolved.thinkingStyle;
  const thinking = thinkingBody(style, selection.thinking);
  const timeout = AbortSignal.timeout(TASK_LIMITS.seconds * 1_000);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  patch({
    id: request.id,
    kind: "agent",
    title: request.description.trim().slice(0, 120),
    status: "running",
    background: false,
    subagent: role.name ?? "Projector task",
    prompt: request.prompt.slice(0, 2_000),
    tool: "task",
    startedAt,
  });
  try {
    const result = streamText({
      model,
      system: TASK_PROMPT,
      prompt: `Проект: ${request.cwd ?? process.cwd()}\n\n${request.description}\n\n${request.prompt}`,
      tools: taskTools(request.cwd, signal),
      stopWhen: stepCountIs(TASK_LIMITS.steps),
      maxRetries: 0,
      maxOutputTokens: TASK_LIMITS.tokens,
      abortSignal: signal,
      providerOptions: thinking ? { qwenOpenai: thinking } : undefined,
    });
    const text = (await result.text).trim();
    const steps = await result.steps;
    if (!text) throw new Error("Task не вернул ответ");
    patch({
      id: request.id,
      status: "done",
      summary: text.replace(/\s+/g, " ").slice(0, 400),
      endedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      tools: steps.reduce((count, step) => count + step.toolCalls.length, 0),
    });
    return { text, ...(role.name ? { role: role.name } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task завершился с ошибкой";
    patch({
      id: request.id,
      status: request.signal?.aborted ? "stopped" : "error",
      summary: message.slice(0, 400),
      endedAt: Date.now(),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
