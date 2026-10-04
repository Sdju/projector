import { environmentForPath, runEnvironmentCommand } from "../environments/index.ts";
import { devcontainerForPath, runDevcontainerCommand } from "../devcontainer/index.ts";
import { os } from "../../../core/modules/os/index.ts";
import type { CommandRequest } from "./command-bridge.ts";
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { expandPath, findProjects, inspectProject, listDirectory } from "../projects/index.ts";
import { loadProjects, updateProjects } from "../projects/index.ts";
import type { LaunchMode, Project } from "../projects/index.ts";

export interface AgentToolContext {
  onProject: (project: Project) => void;
  commands?: (request: CommandRequest) => Promise<unknown>;
  cwd?: string;
  signal?: AbortSignal;
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

export function createAgentTools(context: AgentToolContext) {
  const described = new Set<string>();
  const commands = (request: CommandRequest) => {
    if (!context.commands) throw new Error("Откройте чат агента в проекте для доступа к командам");
    return context.commands(request);
  };
  return {
    list_commands: tool({
      description:
        "Найти существующие команды Projector и их области (scope). Пустой query возвращает весь каталог текущего проекта.",
      inputSchema: z.object({ query: z.string().optional() }),
      execute: ({ query }) => commands({ operation: "list", query }),
    }),
    describe_command: tool({
      description: "Получить описание, аргументы и контекст команды перед вызовом.",
      inputSchema: z.object({ command: z.string(), scope: z.string() }),
      execute: async ({ command, scope }) => {
        const result = await commands({ operation: "describe", command, scope });
        described.add(`${scope}\n${command}`);
        return result;
      },
    }),
    execute_command: tool({
      description: "Вызвать ранее описанную команду Projector в явной области scope.",
      inputSchema: z.object({
        command: z.string(),
        scope: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: ({ command, scope, args }) => {
        if (!described.has(`${scope}\n${command}`))
          throw new Error("Сначала вызови describe_command");
        return commands({ operation: "execute", command, scope, args });
      },
    }),
    bash: tool({
      description:
        "Выполнить Bash в окружении проекта: Dev Container для доверенного проекта, Docker для изолированного, иначе машина пользователя. Возвращает stdout, stderr, exitCode; лимит 30 секунд. cwd по умолчанию — открытый проект.",
      inputSchema: z.object({ command: z.string().min(1), cwd: z.string().optional() }),
      execute: async ({ command, cwd }) => {
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
    list_projects: tool({
      description: "Список уже добавленных в projector проектов.",
      inputSchema: z.object({}),
      execute: async () => {
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
    list_directory: tool({
      description:
        "Показать содержимое папки. Только если путь неясен. Не используй для обхода всех проектов.",
      inputSchema: z.object({
        path: z.string().describe("Абсолютный путь или ~/..."),
      }),
      execute: async ({ path }) => listDirectory(path),
    }),
    find_projects: tool({
      description:
        "Найти запускаемые приложения (vite/nuxt/next/astro) под корнем. Отсекает packages/, docs/, demo/, speech/ и вложенный мусор. Возвращает уже отсортированный короткий список.",
      inputSchema: z.object({
        path: z.string().describe("Корневая папка поиска"),
        depth: z.number().min(1).max(5).optional().describe("Глубина, по умолчанию 4"),
      }),
      execute: async ({ path, depth }) => findProjects(path, depth ?? 4),
    }),
    inspect_path: tool({
      description:
        "Прочитать один package.json. Не нужно перед add_projects — добавление само читает проект.",
      inputSchema: z.object({
        path: z.string().describe("Путь к проекту"),
      }),
      execute: async ({ path }) => inspectProject(path),
    }),
    add_project: tool({
      description: "Добавить один проект. Для нескольких путей используй add_projects.",
      inputSchema: z.object({
        path: z.string().describe("Путь к проекту"),
        name: z.string().optional().describe("Имя, если нужно переименовать"),
        url: z.string().optional().describe("URL dev-сервера, если известен"),
        mode: z.enum(["server", "window"]).optional(),
      }),
      execute: async ({ path, name, url, mode }) => {
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
    add_projects: tool({
      description:
        "Добавить несколько приложений сразу. Сам читает package.json и ищет favicon. Пропускает уже добавленные пути.",
      inputSchema: z.object({
        paths: z.array(z.string()).min(1).max(16).describe("Пути к приложениям из find_projects"),
        mode: z.enum(["server", "window"]).optional(),
      }),
      execute: async ({ paths, mode }) => {
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
  };
}

export const AGENT_SYSTEM_PROMPT = `Ты помощник по управлению Projector: настраиваешь IDE, проекты и их окружение за пользователя. Ты не агент для разработки и не заменяешь Codex, Claude Code, OpenCode и Cursor в терминалах: писать, рефакторить и отлаживать код, чинить сборки и тесты — не твоя задача. На такие просьбы коротко ответь, что для этого нужен терминал с кодовым агентом, и предложи то, что можешь сделать сам.

Что ты делаешь:
- Настройка проекта: название, иконка, адрес и режим запуска, команды запуска (таски), команда по умолчанию, импорт скриптов package.json.
- Чтение вкладок: ide.workbench.tabs.list показывает открытые вкладки, ide.workbench.tab.read возвращает их текст — файлы (с несохранённым черновиком), diff, вывод любого терминала, в том числе скрытого. Так ты видишь, что происходит в терминалах и редакторе; это только чтение, не вводи ничего в терминалы.
- Управление рабочей областью: вкладки, дерево файлов, простые файловые операции, Git (просмотр изменений, stage/unstage), горячие клавиши.
- Общие настройки: ide.workbench.settings.open открывает вкладку Настройки. В scope settings доступны ide.settings.sections.list, ide.settings.section.open с id раздела и ide.settings.search с query.
- GitHub readonly: ide.github.repository.info/refresh в scope github:<projectId>; issues — ide.issues.* (block.toggle, filter, refresh, more, open) в scope issues:<projectId>. Группа issues доступна только в GitHub-проектах. Только просмотр, без клонирования, записи и терминалов.
- Docker — ide.docker.* в scope docker:<projectId>: состояние, Compose-привязка, контейнеры, логи, shell и порты. Действия возвращают терминальную сессию: проверь её exitCode перед заявлением об успехе. Удаление требует явной просьбы; volumes сохраняются. Настройки подключения — scope docker:settings на странице настроек.
- Каталог: найти и добавить приложения в Projector.
- Объяснить, что умеет Projector и где что находится.

Как действовать:
- Любое действие в IDE — через команды Projector: list_commands (поиск по задаче) → describe_command (точные command и scope, аргументы, доступность) → execute_command. Каталог живой и привязан к панелям текущего проекта; не выдумывай команды и аргументы. Доступность проверяется заново при выполнении.
- Настройки проекта — команды ide.project.* в scope project:settings. Начинай с ide.project.settings.get: там id команд. Не правь файлы данных Projector напрямую.
- bash — для проверки фактов (есть ли файл, что в package.json, какие скрипты), а не для изменения кода проекта. Он выполняется у пользователя, ограничен 30 секундами и объёмом вывода; фоновые процессы не запускай, учитывай exitCode и terminated.
- Делай то, о чём просили, и не больше. Неоднозначную просьбу уточни одним вопросом; очевидное делай сразу. Ничего не удаляй и не откатывай без явной просьбы. Не читай и не показывай секреты.
- Результат команды — завершение её обработчика; открытый диалог ждёт действий пользователя, скажи об этом.

Добавление приложений:
- Для каталога с несколькими проектами — find_projects (depth 4), затем add_projects по записям с app:true и высоким score; пропускай packages, docs, demo, workspace-корни. На просьбу «добавь несколько» бери 5–8 лучших. Один путь — add_project. Не выдумывай пути.
- Режим по умолчанию server, window — только по просьбе.

Отвечай по-русски, коротко и по делу: что сделано и что изменилось (для приложений — команда запуска и найдена ли иконка).`;
