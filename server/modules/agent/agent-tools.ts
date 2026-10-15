import { environmentForPath, runEnvironmentCommand } from "../environments/index.ts";
import { devcontainerForPath, runDevcontainerCommand } from "../devcontainer/index.ts";
import { os } from "../../../core/modules/os/index.ts";
import { tool } from "ai";
import { z } from "zod";
import { expandPath, inspectProject, listDirectory } from "../projects/index.ts";
import { createToolSpecs, type ToolSpec, type ToolSpecContext } from "./tool-specs.ts";
import { guardBash, guardCommand, type GuardOptions } from "./projector-guard.ts";
import type { QuestionAnswer, QuestionRequest } from "./command-bridge.ts";

export interface AgentToolContext extends ToolSpecContext {
  cwd?: string;
  signal?: AbortSignal;
  guard: GuardOptions;
  /** Puts questions to the user; absent when the client cannot show them. */
  ask?: (request: QuestionRequest) => Promise<QuestionAnswer>;
}

function specTool(spec: ToolSpec, guard: GuardOptions) {
  return tool({
    description: spec.description,
    inputSchema: z.object(spec.shape),
    execute: async (input) => {
      const call = input as Record<string, unknown>;
      if (spec.name === "execute_command")
        await guardCommand(guard, {
          command: String(call.command),
          scope: String(call.scope),
          args: call.args as Record<string, unknown> | undefined,
        });
      return spec.run(call);
    },
  });
}

export function createAgentTools(context: AgentToolContext) {
  const specTools = Object.fromEntries(
    createToolSpecs(context).map((spec) => [spec.name, specTool(spec, context.guard)]),
  );
  return {
    ...specTools,
    TodoWrite: tool({
      description:
        "Список шагов для многошагового дела: покажи его пользователю в начале и обновляй по ходу (pending, in_progress, completed). Для одного простого действия не нужен.",
      inputSchema: z.object({
        todos: z.array(
          z.object({
            content: z.string().describe("Шаг в повелительном наклонении"),
            activeForm: z
              .string()
              .optional()
              .describe("Что делаешь сейчас, например «Ищу проекты»"),
            status: z.enum(["pending", "in_progress", "completed"]),
          }),
        ),
      }),
      execute: async ({ todos }) => ({ ok: true, count: todos.length }),
    }),
    ...(context.ask
      ? {
          ask_user: tool({
            description:
              "Задать пользователю вопрос с вариантами ответа, когда без выбора не обойтись (какой проект, какой режим). Не используй для очевидного.",
            inputSchema: z.object({
              question: z.string(),
              options: z
                .array(z.object({ label: z.string(), description: z.string().optional() }))
                .max(8),
              multiple: z.boolean().optional(),
            }),
            execute: async ({ question, options, multiple }) => {
              const answer = await context.ask!({
                custom: true,
                questions: [
                  {
                    id: "0",
                    question,
                    multiple: multiple === true,
                    options: options.map((item, index) => ({ id: String(index), ...item })),
                  },
                ],
              });
              if (!answer) return { skipped: true };
              return {
                answer: (answer["0"] ?? []).map((value) => options[Number(value)]?.label ?? value),
              };
            },
          }),
        }
      : {}),
    bash: tool({
      description:
        "Выполнить Bash в окружении проекта: Dev Container для доверенного проекта, Docker для изолированного, иначе машина пользователя. Возвращает stdout, stderr, exitCode; лимит 30 секунд. cwd по умолчанию — открытый проект.",
      inputSchema: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
      execute: async ({ command, cwd }) => {
        await guardBash(context.guard, command);
        const target = expandPath(cwd || context.cwd || os.homeDirectory());
        // A trusted Dev Container takes precedence over the restricted Docker environment.
        const trusted =
          (context.cwd ? await devcontainerForPath(context.cwd) : undefined) ??
          (await devcontainerForPath(target));
        const restricted = trusted
          ? undefined
          : ((context.cwd ? await environmentForPath(context.cwd) : undefined) ??
            (await environmentForPath(target)));
        const environment = trusted ?? restricted;
        if (environment) {
          if (target !== environment.path)
            throw new Error("Bash окружения выполняется только в корне проекта с окружением");
          if (context.signal?.aborted) throw new Error("Запрос остановлен");
          try {
            const result = trusted
              ? await runDevcontainerCommand(
                  trusted,
                  ["/bin/bash", "-c", command],
                  30_000,
                  context.signal,
                )
              : await runEnvironmentCommand(
                  environment,
                  ["/bin/bash", "--noprofile", "--norc", "-c", command],
                  30_000,
                  context.signal,
                );
            return {
              stdout: result.stdout.slice(0, 256 * 1024),
              stderr: result.stderr.slice(0, 256 * 1024),
              exitCode: 0,
            };
          } catch (error) {
            if (context.signal?.aborted) throw new Error("Запрос остановлен");
            const failure = error as { code?: number; stdout?: string; stderr?: string };
            if (typeof failure.code !== "number") throw error;
            return {
              stdout: (failure.stdout || "").slice(0, 256 * 1024),
              stderr: (failure.stderr || "").slice(0, 256 * 1024),
              exitCode: failure.code,
            };
          }
        }
        return os.tools.runBash(command, { cwd: target, signal: context.signal });
      },
    }),
    list_directory: tool({
      description:
        "Показать содержимое папки. Только если путь неясен. Не используй для обхода всех проектов.",
      inputSchema: z.object({
        path: z.string().describe("Абсолютный путь или ~/..."),
      }),
      execute: async ({ path }) => listDirectory(path),
    }),
    inspect_path: tool({
      description:
        "Прочитать один package.json. Не нужно перед add_projects — добавление само читает проект.",
      inputSchema: z.object({
        path: z.string().describe("Путь к проекту"),
      }),
      execute: async ({ path }) => inspectProject(path),
    }),
  };
}
