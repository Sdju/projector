import type { Ref } from "vue";
import { shortcutKey } from "../../../../core/modules/ide/index.ts";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";
import { copyWithNotice } from "../../../common/utilities/notice.ts";
import type { TabRegistry, WorkspaceCapability } from "../../workspace-api/index.ts";
import { workspaceSiteUrl } from "../../workspace-api/index.ts";
import { isEditable, isHtml, isMarkdown, type OpenFile } from "../open-file.ts";

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
  openFile: (path: string) => unknown;
  openTab: (id: string) => void;
  onOpenTab?: () => void;
  toggleMarkdownSource: () => void;
  /** Показывает файл в дереве: открывает сайдбар и раздел «Файлы». */
  revealInTree: (path: string) => void;
  tabTypes: TabRegistry;
}

/** Команды редактора: сохранение, показ в дереве, копирование пути, служебные вкладки и клавиши. */
export function registerEditorCommands(ctx: EditorCommandContext) {
  const { editorCommands, register, tabs, active, activeKey, fileOf, saveFile, openTab } = ctx;
  const { openFile, toggleMarkdownSource } = ctx;
  function commandFile(value?: unknown) {
    const args = commandArgs(value);
    if (args.id !== undefined && typeof args.id !== "string")
      throw new Error("id должен быть строкой");
    return tabs.value.find((tab) => !tab.virtual && tab.key === (args.id ?? activeKey()));
  }
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
    "ide.editor.file.reveal",
    "Показать в дереве файлов",
    (args) => {
      ctx.revealInTree(commandFile(args)!.path);
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
        ? [editorCommands.item("ide.editor.html.openInBrowser", { id }, { separator: true })]
        : []),
      editorCommands.item("ide.editor.file.save", { id }, { separator: true }),
      editorCommands.item("ide.editor.file.reveal", { id }),
      editorCommands.item("ide.editor.file.copyRelativePath", { id }),
      ...common,
    ];
  }
  // A kind that wants a command declares it; the workspace does not know the kinds.
  for (const { id, command } of ctx.tabTypes.list())
    if (command)
      register(
        command.id,
        command.title,
        () => {
          openTab(id);
          ctx.onOpenTab?.();
        },
        () => true,
        command.requires as WorkspaceCapability | undefined,
        { description: command.description },
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
