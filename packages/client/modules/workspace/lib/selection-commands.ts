import { commandArgs } from "../../../common/utilities/commands.ts";
import { attachRangeToChat, attachTextToChat } from "../../agent/index.ts";
import type { WorkspaceCapability } from "../../workspace-api/index.ts";
import type { EditorRange } from "./editor-selection.ts";

export interface SelectionCommandContext {
  projectId: string;
  /** Runs a workspace command, for opening a chat when none is open. */
  run: (id: string, args?: unknown) => Promise<unknown>;
  /** The lines the focused editor reported; absent when no editor has focus. */
  current: () => EditorRange | undefined;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: WorkspaceCapability,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
}

function lineArg(value: unknown, key: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error(`${key}: нужно целое число от 1`);
  return value;
}

/** Commands that put a selection into the agent chat: file lines, or plain text from other surfaces. */
export function registerSelectionCommands(ctx: SelectionCommandContext) {
  const { projectId, register, run } = ctx;
  register(
    "ide.editor.selection.toChat",
    "Добавить выделение в чат",
    async (value) => {
      const args = commandArgs(value);
      if (args.chat !== undefined && typeof args.chat !== "string")
        throw new Error("chat должен быть строкой");
      if (args.text !== undefined) {
        if (typeof args.text !== "string") throw new Error("text должен быть строкой");
        if (args.source !== undefined && typeof args.source !== "string")
          throw new Error("source должен быть строкой");
        await attachTextToChat(projectId, args.text, {
          chat: args.chat,
          source: args.source,
          run,
        });
        return { text: args.text };
      }
      const current = ctx.current();
      if (!args.path && args.from === undefined && current?.text) {
        await attachTextToChat(projectId, current.text, {
          chat: args.chat,
          source: `Выделение из ${current.path}`,
          run,
        });
        return { path: current.path, text: current.text };
      }
      const explicitPath = typeof args.path === "string" ? args.path : undefined;
      const explicitFrom = lineArg(args.from, "from");
      if (explicitPath && !explicitFrom) throw new Error("Укажите from для выбранного файла");
      const path = explicitPath ?? current?.path;
      const from = explicitFrom ?? current?.from;
      const to = lineArg(args.to, "to") ?? (explicitFrom ? from : current?.to);
      if (!path || !from || !to) throw new Error("Выделите строки в файле");
      if (to < from) throw new Error("to: конец диапазона раньше начала");
      await attachRangeToChat(projectId, path, { from, to }, args.chat, run);
      return { path, from, to };
    },
    (value) => {
      const args = commandArgs(value);
      if (typeof args.text === "string") return !!args.text.trim();
      if (typeof args.path === "string" && typeof args.from === "number") return true;
      return !!ctx.current();
    },
    "agent",
    {
      description:
        "Добавляет чип с выбранными строками файла в поле ввода открытого чата агента, не отправляя сообщение. Без выделения берётся строка под курсором. Целевой чат — видимый, иначе последний, с которым работали; если чатов нет, открывается самый свежий сохранённый или новый чат Projector. Текст выделения не передаётся: агент видит @path:12-34 и читает файл сам. Для визуального редактора Markdown и терминала передайте text: в поле ввода попадёт сам выделенный текст, а source подпишет его источник.",
      arguments: {
        path: "Путь относительно корня проекта; без него — файл активного редактора",
        from: "Первая строка диапазона (с 1); без него — строка под курсором",
        to: "Последняя строка диапазона; по умолчанию совпадает с from",
        text: "Выделенный текст вместо диапазона строк (визуальный редактор Markdown, терминал)",
        source: "Подпись источника для text: путь к файлу или название терминала",
        chat: "Ключ чата из ide.agent.chats.list; без него — чат в использовании",
      },
    },
  );
  register(
    "ide.terminal.selection.toChat",
    "Добавить выделение терминала в чат",
    async (value) => {
      const args = commandArgs(value);
      if (typeof args.text !== "string" || !args.text.trim())
        throw new Error("Выделите текст в терминале");
      if (args.chat !== undefined && typeof args.chat !== "string")
        throw new Error("chat должен быть строкой");
      if (args.source !== undefined && typeof args.source !== "string")
        throw new Error("source должен быть строкой");
      await attachTextToChat(projectId, args.text, {
        chat: args.chat,
        source: args.source,
        run,
      });
      return { text: args.text };
    },
    (value) => {
      const args = commandArgs(value);
      return typeof args.text === "string" && !!args.text.trim();
    },
    "agent",
    {
      description:
        "Добавляет выделенный текст терминала в поле ввода открытого чата агента, не отправляя сообщение. Выделение в терминале не связано с файлом, поэтому в поле ввода попадает сам текст; source подписывает, из какого терминала он взят. Целевой чат — видимый, иначе последний, с которым работали; если чатов нет, открывается самый свежий сохранённый или новый чат Projector.",
      arguments: {
        text: "Выделенный текст терминала",
        source: "Подпись источника, например «Терминал «zsh»»",
        chat: "Ключ чата из ide.agent.chats.list; без него — чат в использовании",
      },
    },
  );
}
