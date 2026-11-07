import type { Ref } from "vue";
import { shortcutKey } from "@projector/core/modules/ide/index.ts";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";
import { copyWithNotice } from "../../../common/utilities/notice.ts";
import type { TabRegistry, WorkspaceCapability } from "../../workspace-api/index.ts";
import type { FileScope } from "@projector/core/modules/workspace/index.ts";
import { workspaceSiteUrl } from "../../workspace-api/index.ts";
import { normalizeBrowserInput } from "@projector/core/modules/browser/index.ts";
import { isEditable, isHtml, isMarkdown, type OpenFile } from "../open-file.ts";
import { attachRangeToChat } from "../../agent/index.ts";
import { createEditorSelection, provideEditorSelection } from "./editor-selection.ts";

export interface EditorCommandContext {
  projectId: string;
  editorCommands: ReturnType<typeof useCommandScope>;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
    requires?: WorkspaceCapability,
    meta?: { description?: string; arguments?: Record<string, string> },
  ) => unknown;
  tabs: Ref<OpenFile[]>;
  active: () => OpenFile | undefined;
  activeKey: () => string;
  fileOf: (id: string) => OpenFile | undefined;
  saveFile: (file?: OpenFile) => Promise<boolean>;
  /** Отбрасывает правки вкладки и берёт версию с диска. */
  reloadFromDisk: (file: OpenFile) => Promise<void>;
  /** Оставляет правки вкладки при расхождении с диском. */
  keepMine: (file: OpenFile) => void;
  openFile: (path: string) => unknown;
  /** Opens a file and puts the cursor on `line` or selects the whole `line`..`endLine`. */
  openFileAt: (path: string, line?: number, endLine?: number, column?: number) => unknown;
  openTab: (id: string, params?: Record<string, unknown>, options?: { preview?: boolean }) => void;
  selectTab: (key: string) => void;
  onOpenTab?: () => void;
  toggleMarkdownSource: () => void;
  /** Показывает файл в дереве: открывает сайдбар и раздел этого снимка. */
  revealInTree: (path: string, scope?: FileScope) => void;
  tabTypes: TabRegistry;
}

/** Команды редактора: сохранение, показ в дереве, копирование пути, служебные вкладки и клавиши. */
export function registerEditorCommands(ctx: EditorCommandContext) {
  const { editorCommands, register, tabs, active, activeKey, fileOf, saveFile, openTab } = ctx;
  const { openFile, toggleMarkdownSource } = ctx;
  const selection = provideEditorSelection(
    createEditorSelection(() => editorCommands.run("ide.editor.selection.toChat")),
  );
  function commandFile(value?: unknown) {
    const args = commandArgs(value);
    if (args.id !== undefined && typeof args.id !== "string")
      throw new Error("id должен быть строкой");
    return tabs.value.find((tab) => !tab.virtual && tab.key === (args.id ?? activeKey()));
  }
  function lineArg(value: unknown, key: string) {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
      throw new Error(`${key}: нужно целое число от 1`);
    return value;
  }
  register(
    "ide.editor.path.open",
    "Открыть файл или папку проекта по пути",
    (value) => {
      const args = commandArgs(value);
      if (typeof args.path !== "string" || !args.path) throw new Error("Укажите путь");
      const line = lineArg(args.line, "line");
      const endLine = lineArg(args.endLine, "endLine");
      if (endLine && !line) throw new Error("endLine требует line");
      if (args.directory === true) ctx.revealInTree(args.path);
      else return ctx.openFileAt(args.path, line, endLine, lineArg(args.column, "column"));
    },
    () => true,
    undefined,
    {
      description:
        "Открывает файл проекта во вкладке редактора (или показывает папку в дереве) по пути, относительному корню проекта. Так открываются ссылки на файлы из чата; line и endLine показывают строку или выделяют диапазон.",
      arguments: {
        path: "Путь относительно корня проекта",
        directory: "true, если путь — папка: она будет показана в дереве",
        line: "Строка, на которую поставить курсор (с 1)",
        endLine: "Последняя строка диапазона: файл откроется с выделением line..endLine",
        column: "Столбец курсора (с 1); действует без endLine",
      },
    },
  );
  register(
    "ide.editor.selection.toChat",
    "Добавить выделение в чат",
    async (value) => {
      const args = commandArgs(value);
      const current = selection.current.value;
      const explicitPath = typeof args.path === "string" ? args.path : undefined;
      const explicitFrom = lineArg(args.from, "from");
      if (explicitPath && !explicitFrom) throw new Error("Укажите from для выбранного файла");
      const path = explicitPath ?? current?.path;
      const from = explicitFrom ?? current?.from;
      const to = lineArg(args.to, "to") ?? (explicitFrom ? from : current?.to);
      if (!path || !from || !to) throw new Error("Выделите строки в файле");
      if (to < from) throw new Error("to: конец диапазона раньше начала");
      if (args.chat !== undefined && typeof args.chat !== "string")
        throw new Error("chat должен быть строкой");
      await attachRangeToChat(ctx.projectId, path, { from, to }, args.chat, (id, commandArgument) =>
        ctx.editorCommands.scope.executeCommand(id, commandArgument),
      );
      return { path, from, to };
    },
    (value) => {
      const args = commandArgs(value);
      if (typeof args.path === "string" && typeof args.from === "number") return true;
      return !!selection.current.value;
    },
    "agent",
    {
      description:
        "Добавляет чип с выбранными строками файла в поле ввода открытого чата агента, не отправляя сообщение. Без выделения берётся строка под курсором. Целевой чат — видимый, иначе последний, с которым работали; если чатов нет, открывается самый свежий сохранённый или новый чат Projector. Текст выделения не передаётся: агент видит @path:12-34 и читает файл сам.",
      arguments: {
        path: "Путь относительно корня проекта; без него — файл активного редактора",
        from: "Первая строка диапазона (с 1); без него — строка под курсором",
        to: "Последняя строка диапазона; по умолчанию совпадает с from",
        chat: "Ключ чата из ide.agent.chats.list; без него — чат в использовании",
      },
    },
  );
  register(
    "ide.editor.file.save",
    "Сохранить",
    async (args) => {
      const file = commandFile(args)!;
      if (!(await saveFile(file))) throw new Error(file.saveError || "Не удалось сохранить файл");
    },
    (args) => !!commandFile(args) && isEditable(commandFile(args)!),
    "write",
  );
  register(
    "ide.editor.file.reloadFromDisk",
    "Загрузить файл с диска",
    async (args) => {
      await ctx.reloadFromDisk(commandFile(args)!);
    },
    (args) => !!commandFile(args) && !commandFile(args)!.readonly,
    undefined,
    {
      description:
        "Перечитывает файл с диска и отбрасывает несохранённые правки во вкладке. Разрешает конфликт, когда файл изменили снаружи (например, агент), пока он был открыт с правками.",
      arguments: { id: "Ключ вкладки; по умолчанию активная вкладка" },
    },
  );
  register(
    "ide.editor.file.keepMine",
    "Оставить мою версию файла",
    (args) => {
      ctx.keepMine(commandFile(args)!);
    },
    (args) => commandFile(args)?.conflict?.disk !== undefined,
    "write",
    {
      description:
        "При конфликте с изменением на диске оставляет правки во вкладке: следующее сохранение перезапишет версию на диске. Доступна только пока конфликт есть.",
      arguments: { id: "Ключ вкладки; по умолчанию активная вкладка" },
    },
  );
  register(
    "ide.editor.file.reveal",
    "Показать в дереве файлов",
    (args) => {
      ctx.revealInTree(commandFile(args)!.path, commandFile(args)!.scope);
    },
    (args) => !!commandFile(args) && !commandFile(args)!.external,
  );
  register(
    "ide.editor.file.copyRelativePath",
    "Копировать относительный путь",
    async (args) => {
      await copyWithNotice(null, commandFile(args)!.path, "Путь скопирован");
    },
    (args) => !!commandFile(args),
  );
  register(
    "ide.editor.markdown.toggleSource",
    "Переключить исходник Markdown",
    () => toggleMarkdownSource(),
    () => {
      const file = active();
      return !!file && isMarkdown(file);
    },
  );
  const htmlFile = (args?: unknown) => {
    const file = commandFile(args);
    return file && isHtml(file) && workspaceSiteUrl(ctx.projectId, file.path) ? file : undefined;
  };
  register(
    "ide.editor.html.reload",
    "Перезагрузить HTML-страницу",
    (args) => {
      const file = htmlFile(args)!;
      file.htmlReload = (file.htmlReload ?? 0) + 1;
    },
    (args) => !!htmlFile(args),
    undefined,
    {
      description:
        "Заново загружает страницу открытого HTML-файла вместе со стилями, скриптами и картинками. Страница читает файлы с диска, поэтому несохранённые правки не видны.",
      arguments: { id: "Ключ вкладки; по умолчанию активная вкладка" },
    },
  );
  register(
    "ide.editor.html.openInBrowser",
    "Открыть HTML-страницу в браузере",
    (args) => {
      const file = htmlFile(args)!;
      window.open(workspaceSiteUrl(ctx.projectId, file.path), "_blank", "noopener");
    },
    (args) => !!htmlFile(args),
    undefined,
    {
      description:
        "Открывает HTML-файл как страницу в новой вкладке браузера: относительные пути разрешаются от его каталога в проекте.",
      arguments: { id: "Ключ вкладки; по умолчанию активная вкладка" },
    },
  );
  const browserTab = (args?: unknown) => {
    const id = commandArgs(args).id;
    return tabs.value.find((tab) => tab.virtual === "browser" && tab.key === (id ?? activeKey()));
  };
  const browserUrl = (args?: unknown) => {
    const url = commandArgs(args).url;
    if (typeof url !== "string" || !url.trim()) throw new Error("Укажите адрес страницы");
    return normalizeBrowserInput(url);
  };
  register(
    "ide.workbench.browser.navigate",
    "Открыть адрес в браузере",
    (args) => {
      const url = browserUrl(args);
      const tab = browserTab(args);
      if (tab) {
        tab.params = { ...tab.params, url };
        ctx.selectTab(tab.key);
      } else
        openTab("browser", { ...ctx.tabTypes.get("browser")!.create!(), url }, { preview: false });
      ctx.onOpenTab?.();
    },
    () => ctx.tabTypes.has("browser"),
    undefined,
    {
      description:
        "Открывает адрес во вкладке-псевдобраузере: в активной, если она браузерная (или в вкладке с указанным id), иначе в новой. Принимает полный URL, localhost:порт, домен или поисковый запрос. Страницы из интернета загружаются через прокси Projector, localhost и локальная сеть — напрямую.",
      arguments: {
        url: "URL, localhost:порт, домен или поисковый запрос",
        id: "Ключ браузерной вкладки; по умолчанию активная браузерная, иначе новая",
      },
    },
  );
  register(
    "ide.editor.html.openInBrowserTab",
    "Открыть HTML-страницу во вкладке браузера",
    (args) => {
      const file = htmlFile(args)!;
      const url = new URL(workspaceSiteUrl(ctx.projectId, file.path), location.origin).href;
      openTab(
        "browser",
        { ...ctx.tabTypes.get("browser")!.create!(), url, title: file.path },
        { preview: false },
      );
      ctx.onOpenTab?.();
    },
    (args) => !!htmlFile(args) && ctx.tabTypes.has("browser"),
    undefined,
    {
      description:
        "Открывает HTML-файл проекта как страницу во вкладке-псевдобраузере (с адресной строкой и историей) вместо просмотра рядом с кодом.",
      arguments: { id: "Ключ вкладки; по умолчанию активная вкладка" },
    },
  );
  register(
    "ide.editor.file.open",
    "Открыть файл",
    (args) => openFile(commandFile(args)!.path),
    (args) => !!commandFile(args) && commandFile(args)!.original !== undefined,
  );
  function tabActions(id: string): ContextMenuItem[] {
    const file = fileOf(id);
    const common = [
      editorCommands.item("ide.workbench.panel.splitRight", { id }, { separator: true }),
      editorCommands.item("ide.workbench.panel.splitDown", { id }),
      editorCommands.item("ide.workbench.panel.hideGroup", { id }),
    ];
    if (!file || file.virtual) return common;
    return [
      ...(file.original !== undefined ? [editorCommands.item("ide.editor.file.open", { id })] : []),
      ...(isHtml(file)
        ? [
            editorCommands.item("ide.editor.html.openInBrowserTab", { id }, { separator: true }),
            editorCommands.item("ide.editor.html.openInBrowser", { id }),
          ]
        : []),
      editorCommands.item("ide.editor.file.save", { id }, { separator: true }),
      editorCommands.item("ide.editor.file.reveal", { id }),
      editorCommands.item("ide.editor.file.copyRelativePath", { id }),
      ...common,
    ];
  }
  // A kind that wants a command declares it; the workspace does not know the kinds.
  for (const { id, command, create } of ctx.tabTypes.list())
    if (command)
      register(
        command.id,
        command.title,
        (args) => {
          let params: Record<string, unknown> | undefined;
          if (command.arguments) {
            // Only the declared arguments become tab parameters, and all of them are required.
            const given = commandArgs(args);
            params = {};
            for (const key of Object.keys(command.arguments)) {
              const value = given[key];
              if (typeof value !== "string" || !value) return;
              params[key] = value;
            }
          } else {
            params = create?.();
            // A given optional parameter replaces the new instance's own: it names an existing one.
            const given = commandArgs(args);
            for (const key of Object.keys(command.optional ?? {})) {
              const value = given[key];
              if (typeof value === "string" && value) params = { ...params, [key]: value };
            }
          }
          openTab(id, params);
          ctx.onOpenTab?.();
        },
        () => true,
        command.requires as WorkspaceCapability | undefined,
        { description: command.description, arguments: command.arguments ?? command.optional },
      );
  function editorKeydown(event: KeyboardEvent) {
    const save = ctx.tabTypes.behaviorOf(active()?.virtual)?.save;
    if (save && (event.ctrlKey || event.metaKey) && shortcutKey(event) === "s") {
      event.preventDefault();
      event.stopPropagation();
      void save();
      return;
    }
    if (!(event.target as Element).closest("[data-own-keys], .terminal-view"))
      editorCommands.keydown(event);
  }
  function editorFocus(event: FocusEvent) {
    if (
      !(event.target as Element)?.closest(
        ".workspace-tabs, .keybindings-editor, .terminal-view, .network-panel",
      )
    )
      editorCommands.scope.activate();
  }
  return { tabActions, editorKeydown, editorFocus };
}
