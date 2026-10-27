import { newId } from "../../common/utilities/new-id.ts";
import type { FileWrite, GitWrite, WorkspaceProfile } from "./profile.ts";
import { defineTab, singletonTab } from "./tabs.ts";
import { localWorkspaceWatch } from "./local-watch.ts";

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/workspace`;

async function send(url: string, method: string, body: unknown, failure: string) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || failure);
  return data;
}

/** A plain coding agent behind a chat instead of the TUI; every opening is a new conversation. */
function agentChatTab(program: string, label: string, description: string) {
  return defineTab<{ chatId?: string }>({
    id: program,
    key: (params) => `${program}:${params.chatId ?? "main"}`,
    path: () => label,
    title: () => `${label} в графическом чате`,
    create: () => ({ chatId: newId() }),
    command: {
      id: `ide.workbench.${program}.open`,
      title: `Новая сессия ${label} (GUI)`,
      description,
      requires: "agent",
      optional: { chatId: "Идентификатор уже открытого чата: вкладка этого чата получает фокус" },
    },
  });
}

/** The project directory served by the Projector backend: full capabilities. */
export function createLocalWorkspaceProfile(projectId: string): WorkspaceProfile {
  const read = async (action: string, params: Record<string, string>, signal?: AbortSignal) => {
    const response = await fetch(`${base(projectId)}/${action}?${new URLSearchParams(params)}`, {
      signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось прочитать проект");
    return data;
  };
  return {
    id: "local",
    layout: "full",
    sidebar: [{ id: "docker", title: "Docker", command: "ide.docker.sidebar.open" }],
    tabs: [
      // The Projector agent: the tab without a chat id is the project's original conversation.
      defineTab<{ chatId?: string }>({
        id: "agent",
        key: (params) => (params.chatId ? `agent:chat:${params.chatId}` : "agent:chat"),
        path: () => "Агент",
        title: () => "Чат с агентом Projector",
        create: () => ({ chatId: newId() }),
        command: {
          id: "ide.workbench.agent.open",
          title: "Открыть чат с агентом",
          description:
            "Открывает новую вкладку с чатом агента Projector; вкладок можно открыть сколько нужно, у каждой свой диалог.",
          requires: "agent",
          optional: {
            chatId: "Идентификатор уже открытого чата: вкладка этого чата получает фокус",
          },
        },
      }),
      // Plain coding agents behind a chat instead of the TUI; every opening is a new conversation.
      agentChatTab(
        "claude",
        "Claude Code",
        "Открывает вкладку с Claude Code в графическом чате вместо терминала: отдельный диалог в папке проекта, запросы разрешений в чате.",
      ),
      agentChatTab(
        "codex",
        "Codex",
        "Открывает вкладку с Codex в графическом чате вместо терминала: отдельный диалог в папке проекта, запросы разрешений в чате.",
      ),
      agentChatTab(
        "opencode",
        "OpenCode",
        "Открывает вкладку с OpenCode в графическом чате вместо терминала: отдельный диалог в папке проекта, запросы разрешений в чате.",
      ),
      agentChatTab(
        "cursor",
        "Cursor",
        "Открывает вкладку с Cursor в графическом чате вместо терминала: отдельный диалог в папке проекта, запросы разрешений в чате.",
      ),
      // A subagent or background command of a chat, followed in its own tab (read-only).
      defineTab<{ chat: string; task: string; title?: string }>({
        id: "agent-task",
        key: ({ chat, task }) => `agent-task:${chat}:${task}`,
        path: ({ title }) => title || "Задача агента",
        title: ({ title }) => title || "Субагент или фоновая команда агента",
        subtitle: "задача агента",
        read: ({ title }, content) => ({ text: content, note: `Задача агента: ${title ?? ""}` }),
        command: {
          id: "ide.workbench.agent.task.open",
          title: "Открыть задачу агента во вкладке",
          description:
            "Открывает субагента или фоновую команду чата в отдельной вкладке только для чтения: задание, вызовы инструментов и итог обновляются по ходу работы. Список задач и ключи даёт ide.agent.tasks.list.",
          requires: "agent",
          arguments: {
            chat: "Ключ чата из ide.agent.chats.list",
            task: "Идентификатор задачи из ide.agent.tasks.list",
            title: "Название вкладки (необязательно)",
          },
        },
      }),
      // A background agent job followed in its own tab: the journal, the answer, the requests.
      defineTab<{ job: string; title?: string }>({
        id: "agent-job",
        key: ({ job }) => `agent-job:${job}`,
        path: ({ title }) => title || "Фоновое задание",
        title: ({ title }) => title || "Фоновое задание агента",
        subtitle: "фоновое задание",
        read: ({ title }, content) => ({
          text: content,
          note: `Фоновое задание агента: ${title ?? ""}`,
        }),
        command: {
          id: "ide.workbench.agent.job.open",
          title: "Открыть фоновое задание агента во вкладке",
          description:
            "Открывает фоновое задание агента в отдельной вкладке: лента событий, итог, изменённые файлы, запросы, которые ждут ответа, кнопки остановки и продолжения в чате. Идентификаторы заданий даёт ide.agent.jobs.list.",
          requires: "agent",
          arguments: { job: "Идентификатор задания из ide.agent.jobs.list" },
        },
      }),
      singletonTab("project", "settings:project", "Настройки проекта", "Настройки проекта", {
        subtitle: "иконка, запуск и сценарии",
        command: {
          id: "ide.workbench.project.settings.open",
          title: "Открыть настройки проекта",
          description:
            "Открывает вкладку настроек проекта: иконка, параметры запуска и сценарии (команды запуска). Повторный вызов фокусирует вкладку.",
        },
      }),
      singletonTab("docker", "docker:overview", "Docker", "Контейнеры и Compose"),
    ],
    features: {
      terminals: true,
      docker: true,
      agent: true,
      settings: true,
      persist: true,
      externalFiles: true,
    },
    providers: {
      files: {
        read,
        watch: localWorkspaceWatch(projectId),
        assetUrl: (path, external = false) =>
          `${base(projectId)}/${external ? "external-asset" : "asset"}?${new URLSearchParams({ path })}`,
        siteUrl: (path) =>
          `/api/projects/${encodeURIComponent(projectId)}/site/${path.split("/").map(encodeURIComponent).join("/")}`,
        upload: async (directory, path, body, signal) => {
          const response = await fetch(
            `${base(projectId)}/upload?${new URLSearchParams({ directory, path, ...(body ? {} : { kind: "directory" }) })}`,
            { method: "PUT", body, signal },
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Не удалось загрузить файл");
          return data;
        },
        write: (endpoint: FileWrite, body, failure = "Не удалось выполнить действие") =>
          send(
            `${base(projectId)}/${endpoint}`,
            endpoint === "file" ? "PUT" : "POST",
            body,
            failure,
          ),
      },
      git: {
        read,
        write: (endpoint: GitWrite, body, failure = "Не удалось выполнить действие Git") =>
          send(`${base(projectId)}/${endpoint}`, "POST", body, failure),
      },
      search: { read },
    },
  };
}
