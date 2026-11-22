import { commandArgs } from "../../../../../common/utilities/commands.ts";
import { attachChipsToChat, attachTextToChat } from "../../../../agent/index.ts";
import type { WorkspaceCapability } from "../../../../workspace-api/index.ts";
import { formatReviewMessage, reviewChips } from "./review-message.ts";
import type { ReviewRange, ReviewSession } from "./review-session.ts";

export interface ReviewCommandContext {
  projectId: string;
  review: ReviewSession;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: WorkspaceCapability,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
  /** Opens or focuses the review tab. */
  openTab: () => void;
  /** Opens the file or diff the remark belongs to, with the lines selected. */
  openFile: (path: string, from: number, to: number, staged?: boolean) => unknown;
  /** Runs a workspace command, for opening a chat when none is open. */
  run: (id: string, args?: unknown) => Promise<unknown>;
}

function integerArg(value: unknown, key: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new Error(`${key}: нужно целое число от 1`);
  return value;
}

function rangeFrom(args: Record<string, unknown>, fallback?: ReviewRange): ReviewRange {
  const path = typeof args.path === "string" ? args.path : fallback?.path;
  const from = integerArg(args.from, "from") ?? fallback?.from;
  const to = integerArg(args.to, "to") ?? (args.from !== undefined ? from : fallback?.to);
  if (!path || !from || !to) throw new Error("Укажите path, from и to");
  if (args.staged !== undefined && typeof args.staged !== "boolean")
    throw new Error("staged должен быть boolean");
  if (args.snippet !== undefined && typeof args.snippet !== "string")
    throw new Error("snippet должен быть строкой");
  return {
    path,
    from,
    to,
    staged: typeof args.staged === "boolean" ? args.staged : fallback?.staged,
    snippet: typeof args.snippet === "string" ? args.snippet : fallback?.snippet,
  };
}

/** Commands of a local change review: remarks, the summary tab and sending them to chat. */
export function registerReviewCommands(ctx: ReviewCommandContext) {
  const { review, register } = ctx;
  register(
    "ide.review.open",
    "Открыть ревью",
    () => {
      ctx.openTab();
      return { comments: review.comments.value.length };
    },
    () => true,
    "git",
    {
      description:
        "Открывает вкладку со списком замечаний текущего ревью. Повторный вызов фокусирует её.",
    },
  );
  register(
    "ide.review.comment.add",
    "Добавить замечание ревью",
    (value) => {
      const args = commandArgs(value);
      if (args.text !== undefined && typeof args.text !== "string")
        throw new Error("text должен быть строкой");
      const range = rangeFrom(args, review.composing.value);
      const text = typeof args.text === "string" ? args.text : undefined;
      if (text !== undefined) return review.add({ ...range, text });
      ctx.openFile(range.path, range.from, range.to, range.staged);
      review.begin(range);
      return { composing: range };
    },
    () => true,
    "git",
    {
      description:
        "Добавляет замечание к строкам файла в текущем ревью. С text записывает сразу; без text открывает встроенное поле ввода под строками.",
      arguments: {
        path: "Путь относительно корня проекта",
        from: "Первая строка (с 1)",
        to: "Последняя строка; по умолчанию совпадает с from",
        text: "Текст замечания; без него откроется встроенный ввод",
        staged: "true — diff индекса, false — рабочей копии",
        snippet: "Необязательный фрагмент комментируемых строк",
      },
    },
  );
  register(
    "ide.review.comment.update",
    "Изменить замечание ревью",
    (value) => {
      const args = commandArgs(value);
      if (typeof args.id !== "string" || !args.id) throw new Error("Укажите id замечания");
      if (typeof args.text !== "string") throw new Error("Укажите новый текст замечания");
      return review.update(args.id, args.text);
    },
    () => review.comments.value.length > 0,
    "git",
    {
      description: "Изменяет текст существующего замечания ревью по его идентификатору.",
      arguments: {
        id: "Идентификатор замечания",
        text: "Новый текст замечания",
      },
    },
  );
  register(
    "ide.review.comment.remove",
    "Удалить замечание ревью",
    (value) => {
      const id = commandArgs(value).id;
      if (typeof id !== "string" || !id) throw new Error("Укажите id замечания");
      review.remove(id);
      return { id };
    },
    () => review.comments.value.length > 0,
    "git",
    {
      description: "Удаляет замечание по идентификатору из списка ревью или встроенной карточки.",
      arguments: { id: "Идентификатор замечания" },
    },
  );
  register(
    "ide.review.comment.open",
    "Перейти к замечанию ревью",
    (value) => {
      const id = commandArgs(value).id;
      if (typeof id !== "string" || !id) throw new Error("Укажите id замечания");
      const comment = review.comment(id);
      if (!comment) throw new Error("Замечание не найдено");
      ctx.openFile(comment.path, comment.from, comment.to, comment.staged);
      return { path: comment.path, from: comment.from, to: comment.to };
    },
    () => review.comments.value.length > 0,
    "git",
    {
      description: "Открывает файл или diff на строках замечания.",
      arguments: { id: "Идентификатор замечания" },
    },
  );
  register(
    "ide.review.clear",
    "Очистить замечания ревью",
    () => ({ removed: review.clear() }),
    () => review.comments.value.length > 0,
    "git",
    {
      description: "Удаляет все замечания текущего ревью.",
    },
  );
  register(
    "ide.review.toChat",
    "Отправить замечания ревью в чат",
    async (value) => {
      const args = commandArgs(value);
      if (args.chat !== undefined && typeof args.chat !== "string")
        throw new Error("chat должен быть строкой");
      const comments = review.comments.value;
      const text = formatReviewMessage(comments);
      await attachChipsToChat(ctx.projectId, reviewChips(comments), {
        chat: args.chat,
        run: ctx.run,
      });
      await attachTextToChat(ctx.projectId, text, { chat: args.chat, run: ctx.run });
      review.markSent();
      return { comments: comments.length };
    },
    () => review.comments.value.length > 0,
    "agent",
    {
      description:
        "Кладёт все замечания текущего ревью в поле ввода открытого чата агента, не отправляя сообщение: чипы файлов с диапазонами строк и текст замечаний. Пользователь отправляет сам. Целевой чат — видимый, иначе последний; если чатов нет, открывается новый.",
      arguments: { chat: "Ключ чата из ide.agent.chats.list; без него — чат в использовании" },
    },
  );
}
