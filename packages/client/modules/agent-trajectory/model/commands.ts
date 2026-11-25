/** Agent-facing commands that generate a session trajectory and open it as a tab or panel. */

import { commandArgs } from "../../../common/utilities/commands.ts";
import { chatsOf } from "../../agent-core/index.ts";
import {
  generateTrajectoryDocument,
  type TrajectoryGeneration,
  type TrajectorySession,
} from "./generator.ts";
import {
  focusTrajectoryDocument,
  latestTrajectoryDocument,
  putTrajectoryDocument,
} from "./store.ts";
import type { TrajectoryDocument, TrajectoryDocumentOptions } from "./types.ts";

type Register = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: undefined,
  meta?: { description?: string; arguments?: Record<string, string> },
) => unknown;

export interface TrajectoryCommandHost {
  register: Register;
  projectId: string;
  openTab: (id: string, params?: Record<string, unknown>, options?: { preview?: boolean }) => void;
  /** Enables and selects the right-panel section, then shows it. */
  showPanel: (id: string) => void;
  /** The right panel is unavailable on a phone; open the tab instead. */
  mobile: () => boolean;
}

function hasPayload(args: Record<string, unknown>): boolean {
  return ["data", "document", "format", "version", "turns", "records"].some(
    (key) => args[key] !== undefined,
  );
}

function documentOf(args: Record<string, unknown>) {
  const payload = args.document ?? args.data ?? args;
  const options: TrajectoryDocumentOptions = {
    ...(typeof args.id === "string" && args.id ? { id: args.id } : {}),
    ...(typeof args.title === "string" && args.title ? { title: args.title } : {}),
    ...(typeof args.subtitle === "string" && args.subtitle ? { subtitle: args.subtitle } : {}),
    source: "command",
  };
  return putTrajectoryDocument(payload, options);
}

function readDocument(args: Record<string, unknown>) {
  if (hasPayload(args)) return documentOf(args);
  const id = typeof args.id === "string" && args.id ? args.id : undefined;
  if (id) {
    const document = focusTrajectoryDocument(id);
    if (!document) throw new Error(`Документ траектории не найден: ${id}`);
    return document;
  }
  const latest = latestTrajectoryDocument().value;
  if (!latest)
    throw new Error("Нет данных траектории: передайте data или откройте .trajectory.json");
  return latest;
}

function textArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} должен быть строкой`);
  return value;
}

function sessionOf(args: Record<string, unknown>, projectId: string): TrajectorySession {
  const chatKey = textArg(args, "chat");
  const session = textArg(args, "session");
  const backend = textArg(args, "backend");
  const title = textArg(args, "title");
  if (session) {
    if (chatKey) throw new Error("Укажите либо chat, либо session");
    if (!backend) throw new Error("Для session нужен backend агента");
    return { projectId, session, backend, ...(title ? { title } : {}) };
  }

  const chats = chatsOf(projectId);
  const chat = chatKey ? chats.find((item) => item.key === chatKey) : chats[0];
  if (chatKey && !chat)
    throw new Error(`Чат «${chatKey}» не открыт; открытые даёт ide.agent.chats.list`);
  if (!chat) throw new Error("Укажите chat или session (для прошлой сессии ещё backend)");
  if (backend && backend !== chat.backend)
    throw new Error(`Чат «${chat.key}» работает с ${chat.backend}`);
  return {
    projectId,
    backend: chat.backend,
    chat: chat.key,
    turns: chat.turns(),
    title: title ?? chat.label,
    busy: chat.busy(),
  };
}

async function generate(args: Record<string, unknown>, projectId: string) {
  const adapter = textArg(args, "adapter");
  const id = textArg(args, "id");
  const title = textArg(args, "title");
  const subtitle = textArg(args, "subtitle");
  return generateTrajectoryDocument(sessionOf(args, projectId), {
    ...(adapter ? { adapter } : {}),
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
  });
}

function openTab(document: TrajectoryDocument) {
  return { id: document.id, title: document.title, surface: "tab" };
}

function showPanel(document: TrajectoryDocument): { id: string; title: string; surface: string } {
  return { id: document.id, title: document.title, surface: "panel" };
}

function openSurface(
  generation: TrajectoryGeneration,
  host: TrajectoryCommandHost,
  surface: "tab" | "panel",
) {
  const document = generation.document;
  const result = {
    adapter: generation.adapter,
    ...(generation.warning ? { warning: generation.warning } : {}),
  };
  if (surface === "panel" && !host.mobile()) {
    host.showPanel(document.id);
    return { ...showPanel(document), ...result };
  }
  host.openTab("trajectory", { id: document.id, title: document.title }, { preview: false });
  return { ...openTab(document), ...result };
}

const ARGUMENTS: Record<string, string> = {
  data: "Объект траектории: { turns?, records?, counts?, usage?, capabilities?, notice? } или JSON-строка",
  document: "Готовый документ: { title?, subtitle?, data }",
  title: "Заголовок вкладки или панели",
  subtitle: "Короткое пояснение под заголовком",
  id: "Идентификатор документа; повторный вызов с тем же id обновляет его",
};

const SESSION_ARGUMENTS: Record<string, string> = {
  chat: "Ключ открытого чата из ide.agent.chats.list; без него берётся чат, с которым работали последним",
  session: "Идентификатор прошлой сессии агента",
  backend:
    "Агент сессии: projector, opencode, claude, codex, kimi, antigravity; для session обязателен",
  adapter:
    "Адаптер: turns (история чата), projector, opencode. Без него выбирается по backend, затем turns",
  id: "Идентификатор документа; повторный вызов обновляет его",
  title: "Заголовок вкладки или панели",
  subtitle: "Пояснение под заголовком",
};

/** Registers data commands, session generators and the two surfaces. */
export function registerTrajectoryCommands(host: TrajectoryCommandHost): void {
  host.register(
    "ide.trajectory.open",
    "Открыть траекторию во вкладке",
    (value) => {
      const document = readDocument(commandArgs(value));
      host.openTab("trajectory", { id: document.id, title: document.title }, { preview: false });
      return { id: document.id, title: document.title, surface: "tab" };
    },
    () => true,
    undefined,
    {
      description:
        "Открывает вкладку с траекторией агента: обзорная шкала, журнал ходов и инспектор записи. Данные передаются аргументом data или готовым документом; без data открывается последний документ. Поддерживаются записи user, assistant, thought, tool, subtool, task, note, judge, context, system и compaction; поля, которых нет, панель честно помечает как недоступные. Данные живут в памяти страницы до перезагрузки. Файл .trajectory.json открывается как вкладка через ide.editor.path.open.",
      arguments: ARGUMENTS,
    },
  );
  host.register(
    "ide.trajectory.panel",
    "Открыть траекторию в правой панели",
    (value) => {
      const document = readDocument(commandArgs(value));
      if (host.mobile()) {
        host.openTab("trajectory", { id: document.id, title: document.title }, { preview: false });
        return { id: document.id, title: document.title, surface: "tab" };
      }
      host.showPanel(document.id);
      return { id: document.id, title: document.title, surface: "panel" };
    },
    () => true,
    undefined,
    {
      description:
        "Показывает ту же траекторию в правой панели workspace и включает эту панель для проекта. Данные передаются так же, как в ide.trajectory.open; без data открывается последний документ. На телефоне открывается вкладка, потому что правой панели нет.",
      arguments: ARGUMENTS,
    },
  );
  host.register(
    "ide.trajectory.session.generate",
    "Собрать траекторию из сессии",
    async (value) => {
      const generation = await generate(commandArgs(value), host.projectId);
      return {
        id: generation.document.id,
        title: generation.document.title,
        adapter: generation.adapter,
        ...(generation.warning ? { warning: generation.warning } : {}),
        counts: generation.document.data.counts,
      };
    },
    () => true,
    undefined,
    {
      description:
        "Собирает траекторию активной ветки чата или указанной прошлой сессии и сохраняет документ. OpenCode раскрывает шаги и TTFT для явно выбранной session. Если удалось получить только общую историю, warning объясняет причину. Документ открывается через ide.trajectory.open с его id.",
      arguments: SESSION_ARGUMENTS,
    },
  );
  host.register(
    "ide.trajectory.session.open",
    "Открыть сессию как траекторию во вкладке",
    async (value) => {
      const generation = await generate(commandArgs(value), host.projectId);
      return openSurface(generation, host, "tab");
    },
    () => true,
    undefined,
    {
      description:
        "Открывает траекторию активной ветки чата или указанной прошлой сессии во вкладке. Шаги и TTFT OpenCode доступны для явно выбранной session.",
      arguments: SESSION_ARGUMENTS,
    },
  );
  host.register(
    "ide.trajectory.session.panel",
    "Открыть сессию как траекторию в правой панели",
    async (value) => {
      const generation = await generate(commandArgs(value), host.projectId);
      return openSurface(generation, host, "panel");
    },
    () => true,
    undefined,
    {
      description:
        "То же, что ide.trajectory.session.open, но в правой панели workspace; панель включается для проекта. На телефоне открывается вкладка.",
      arguments: SESSION_ARGUMENTS,
    },
  );
}
