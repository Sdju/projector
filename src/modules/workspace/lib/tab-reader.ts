import { commandArgs } from "../../../common/utilities/commands.ts";
import type { DockGroup, DockLayout } from "../../dock/index.ts";
import type { TerminalSession } from "../../../../core/modules/terminal/index.ts";
import type { OpenFile } from "../open-file.ts";

const DEFAULT_CHARS = 20_000;
const MAX_CHARS = 100_000;

export interface TabReaderContext {
  layout: () => DockLayout;
  groups: (layout: DockLayout) => DockGroup[];
  fileOf: (id: string) => OpenFile | undefined;
  terminalOf: (id: string) => TerminalSession | undefined;
  label: (id: string) => string;
  isDirty: (file: OpenFile) => boolean;
  readTerminal: (
    sessionId: string,
    lines?: number,
  ) => Promise<{ text: string; totalLines: number; truncated: boolean }>;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    description: string,
    arguments_?: Record<string, string>,
  ) => unknown;
}

function kindOf(file: OpenFile | undefined, terminal: TerminalSession | undefined): string {
  if (terminal) return "terminal";
  if (!file) return "unknown";
  if (file.virtual) return file.virtual;
  if (file.image) return "image";
  if (file.archive) return "archive";
  if (file.binary) return "binary";
  return file.original !== undefined || file.commit ? "diff" : "file";
}

/** Текстовое представление файловой вкладки; для нетекстовых вкладок — описание. */
function fileText(file: OpenFile): { text?: string; note?: string } {
  if (file.virtual === "commit")
    return { text: file.content, note: `Обзор коммита ${file.commit ?? ""}` };
  if (file.virtual)
    return { note: "Служебная вкладка с интерфейсом: у неё нет текстового содержимого" };
  if (file.image) return { note: "Изображение: текстового содержимого нет" };
  if (file.archive)
    return {
      text: file.archive.entries.map((entry) => `${entry.type}\t${entry.size}\t${entry.path}`).join("\n"),
      note: `Архив ${file.archive.format}${file.archive.truncated ? ", список усечён" : ""}`,
    };
  if (file.binary) return { note: "Двоичный файл: текстового содержимого нет" };
  const current = file.draft ?? file.content;
  if (file.original !== undefined)
    return { text: `--- было\n${file.original}\n--- стало\n${current}`, note: "Сравнение версий" };
  return { text: current };
}

/** Команды чтения вкладок для людей и штатного агента: список вкладок и их текст. */
export function registerTabReader(ctx: TabReaderContext) {
  function tabs() {
    const layout = ctx.layout();
    return ctx.groups(layout).flatMap((group) =>
      group.panels.map((id) => {
        const file = ctx.fileOf(id);
        const terminal = ctx.terminalOf(id);
        return {
          id,
          label: ctx.label(id),
          kind: kindOf(file, terminal),
          path: file && !file.virtual ? file.path : undefined,
          group: group.id,
          active: group.active === id,
          focused: layout.focused === group.id,
          hidden: !!group.hidden,
          dirty: file ? ctx.isDirty(file) : undefined,
          status: terminal?.status,
          exitCode: terminal?.exitCode,
        };
      }),
    );
  }
  ctx.register(
    "ide.workbench.tabs.list",
    "Список открытых вкладок",
    () => ({ tabs: tabs() }),
    () => true,
    "Только чтение. Возвращает все открытые вкладки: id, название, тип (file, diff, image, terminal, agent и т. д.), путь, блок, признаки active/focused/hidden и несохранённых изменений, статус терминала. id используйте в ide.workbench.tab.read.",
  );
  ctx.register(
    "ide.workbench.tab.read",
    "Прочитать содержимое вкладки",
    async (value) => {
      const args = commandArgs(value);
      if (args.id !== undefined && typeof args.id !== "string")
        throw new Error("id должен быть строкой");
      if (args.maxChars !== undefined && typeof args.maxChars !== "number")
        throw new Error("maxChars должен быть числом");
      if (args.lines !== undefined && typeof args.lines !== "number")
        throw new Error("lines должен быть числом");
      const layout = ctx.layout();
      const id = (args.id as string | undefined) ?? ctx.groups(layout).find((g) => g.id === layout.focused)?.active;
      const info = tabs().find((tab) => tab.id === id);
      if (!id || !info) throw new Error("Вкладка не найдена: посмотрите ide.workbench.tabs.list");
      const limit = Math.max(1, Math.min(MAX_CHARS, Math.floor(args.maxChars ?? DEFAULT_CHARS)));
      const file = ctx.fileOf(id);
      const terminal = ctx.terminalOf(id);
      let text: string | undefined;
      let note: string | undefined;
      let totalLines: number | undefined;
      let linesTruncated = false;
      if (terminal) {
        const read = await ctx.readTerminal(terminal.id, args.lines);
        ({ text, totalLines } = read);
        linesTruncated = read.truncated;
        note = "Текст экрана терминала без цветов; показаны последние строки";
      } else if (file) ({ text, note } = fileText(file));
      let truncated = linesTruncated;
      if (text !== undefined && text.length > limit) {
        // Terminal tails matter most; file heads are the natural starting point.
        text = terminal ? text.slice(-limit) : text.slice(0, limit);
        truncated = true;
      }
      return { ...info, text, note, truncated, totalLines, chars: text?.length };
    },
    () => true,
    "Только чтение. Возвращает текстовое представление вкладки: содержимое файла (с несохранённым черновиком), оба варианта diff, список архива или текущий экран и прокрутку терминала (в том числе скрытого). Служебные вкладки и изображения дают только описание. Без id читается активная вкладка блока с фокусом.",
    {
      id: "id вкладки из ide.workbench.tabs.list (необязательно)",
      maxChars: `Лимит символов, по умолчанию ${DEFAULT_CHARS}, максимум ${MAX_CHARS}`,
      lines: "Для терминала: сколько последних строк взять, по умолчанию 200, максимум 2000",
    },
  );
}
