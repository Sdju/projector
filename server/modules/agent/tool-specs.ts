import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CommandRequest } from "./command-bridge.ts";
import { findProjects, inspectProject, loadProjects, updateProjects } from "../projects/index.ts";
import type { LaunchMode, Project } from "../projects/index.ts";

/**
 * Provider-neutral tool definition. Backends adapt it to their own tool API
 * (AI SDK `tool`, Claude Code MCP `tool`, ...), so a new Projector capability is written once.
 */
export interface ToolSpec {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (input: Record<string, unknown>) => unknown;
}

function defineSpec<S extends z.ZodRawShape>(spec: {
  name: string;
  description: string;
  shape: S;
  run: (input: z.infer<z.ZodObject<S>>) => unknown;
}): ToolSpec {
  return { ...spec, run: (input) => spec.run(input as z.infer<z.ZodObject<S>>) };
}

export interface ToolSpecContext {
  onProject: (project: Project) => void;
  commands?: (request: CommandRequest) => Promise<unknown>;
}

async function addFromPath(
  path: string,
  overrides: { name?: string; url?: string; mode?: LaunchMode } = {},
): Promise<{ project: Project; created: boolean }> {
  const inspected = await inspectProject(path);
  const project: Project = {
    id: randomUUID(),
    name: overrides.name?.trim() || inspected.name,
    path: inspected.path,
    url: overrides.url?.trim() || inspected.url,
    icon: inspected.icon,
    mode: overrides.mode ?? inspected.mode,
    defaultCommandId: inspected.defaultCommandId,
    commands: inspected.commands,
    createdAt: new Date().toISOString(),
  };
  let result = { project, created: true };
  await updateProjects((projects) => {
    const existing = projects.find((item) => item.path === inspected.path);
    if (existing) result = { project: existing, created: false };
    else projects.push(project);
  });
  return result;
}

/** Projector IDE command access and the project catalog: shared by every agent backend. */
export function createToolSpecs(context: ToolSpecContext): ToolSpec[] {
  const described = new Set<string>();
  const commands = (request: CommandRequest) => {
    if (!context.commands) throw new Error("Откройте чат агента в проекте для доступа к командам");
    return context.commands(request);
  };
  return [
    defineSpec({
      name: "list_commands",
      description:
        "Найти существующие команды Projector и их области (scope). Пустой query возвращает весь каталог текущего проекта.",
      shape: { query: z.string().optional() },
      run: ({ query }) => commands({ operation: "list", query }),
    }),
    defineSpec({
      name: "describe_command",
      description: "Получить описание, аргументы и контекст команды перед вызовом.",
      shape: { command: z.string(), scope: z.string() },
      run: async ({ command, scope }) => {
        const result = await commands({ operation: "describe", command, scope });
        described.add(`${scope}\n${command}`);
        return result;
      },
    }),
    defineSpec({
      name: "execute_command",
      description: "Вызвать ранее описанную команду Projector в явной области scope.",
      shape: {
        command: z.string(),
        scope: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      },
      run: ({ command, scope, args }) => {
        if (!described.has(`${scope}\n${command}`))
          throw new Error("Сначала вызови describe_command");
        return commands({ operation: "execute", command, scope, args });
      },
    }),
    defineSpec({
      name: "list_projects",
      description: "Список уже добавленных в projector проектов.",
      shape: {},
      run: async () => {
        const projects = await loadProjects();
        return projects.map((item) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          url: item.url,
          icon: item.icon || null,
          commands: item.commands.map((command) => command.name),
        }));
      },
    }),
    defineSpec({
      name: "find_projects",
      description:
        "Найти запускаемые приложения (vite/nuxt/next/astro) под корнем. Отсекает packages/, docs/, demo/, speech/ и вложенный мусор. Возвращает уже отсортированный короткий список.",
      shape: {
        path: z.string().describe("Корневая папка поиска"),
        depth: z.number().min(1).max(5).optional().describe("Глубина, по умолчанию 4"),
      },
      run: ({ path, depth }) => findProjects(path, depth ?? 4),
    }),
    defineSpec({
      name: "add_project",
      description: "Добавить один проект. Для нескольких путей используй add_projects.",
      shape: {
        path: z.string().describe("Путь к проекту"),
        name: z.string().optional().describe("Имя, если нужно переименовать"),
        url: z.string().optional().describe("URL dev-сервера, если известен"),
        mode: z.enum(["server", "window"]).optional(),
      },
      run: async ({ path, name, url, mode }) => {
        const { project, created } = await addFromPath(path, { name, url, mode });
        if (created) context.onProject(project);
        return {
          added: created,
          existed: !created,
          id: project.id,
          name: project.name,
          path: project.path,
          url: project.url,
          icon: project.icon || null,
          mode: project.mode,
          commands: project.commands.map((item) => ({ name: item.name, cmd: item.cmd })),
        };
      },
    }),
    defineSpec({
      name: "add_projects",
      description:
        "Добавить несколько приложений сразу. Сам читает package.json и ищет favicon. Пропускает уже добавленные пути.",
      shape: {
        paths: z.array(z.string()).min(1).max(16).describe("Пути к приложениям из find_projects"),
        mode: z.enum(["server", "window"]).optional(),
      },
      run: async ({ paths, mode }) => {
        const added: unknown[] = [];
        const existed: unknown[] = [];
        const errors: unknown[] = [];
        for (const path of paths) {
          try {
            const { project, created } = await addFromPath(path, { mode });
            const row = {
              id: project.id,
              name: project.name,
              path: project.path,
              url: project.url,
            };
            if (created) {
              context.onProject(project);
              added.push(row);
            } else {
              existed.push(row);
            }
          } catch (error) {
            errors.push({
              path,
              error: error instanceof Error ? error.message : "не удалось добавить",
            });
          }
        }
        return { added, existed, errors };
      },
    }),
  ];
}
