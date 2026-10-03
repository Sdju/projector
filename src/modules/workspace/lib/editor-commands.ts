import type { Ref } from "vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";
import { isEditable, isMarkdown, type OpenFile } from "../open-file.ts";

export interface EditorCommandContext {
  editorCommands: ReturnType<typeof useCommandScope>;
  register: (
    id: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean,
  ) => unknown;
  tabs: Ref<OpenFile[]>;
  active: () => OpenFile | undefined;
  activeKey: () => string;
  fileOf: (id: string) => OpenFile | undefined;
  saveFile: (file?: OpenFile) => Promise<boolean>;
  openFile: (path: string) => unknown;
  selectTab: (key: string) => void;
  toggleMarkdownSource: () => void;
  /** Показывает файл в дереве: открывает сайдбар и раздел «Файлы». */
  revealInTree: (path: string) => void;
  saveProjectSettings?: () => void | Promise<void>;
}

/** Команды редактора: сохранение, показ в дереве, копирование пути, служебные вкладки и клавиши. */
export function registerEditorCommands(ctx: EditorCommandContext) {
  const { editorCommands, register, tabs, active, activeKey, fileOf, saveFile, selectTab } = ctx;
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
    (args) => navigator.clipboard.writeText(commandFile(args)!.path),
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
      editorCommands.item("ide.editor.file.save", { id }, { separator: true }),
      editorCommands.item("ide.editor.file.reveal", { id }),
      editorCommands.item("ide.editor.file.copyRelativePath", { id }),
      ...common,
    ];
  }
  register(
    "ide.workbench.keybindings.open",
    "Открыть горячие клавиши",
    () => {
      const key = "settings:keybindings";
      if (!tabs.value.some((tab) => tab.key === key))
        tabs.value.push({ key, virtual: "keybindings", path: "Горячие клавиши", content: "" });
      selectTab(key);
    },
    () => true,
  );
  register(
    "ide.workbench.agent.open",
    "Открыть чат с агентом",
    () => {
      const key = "agent:chat";
      if (!tabs.value.some((tab) => tab.key === key))
        tabs.value.push({ key, virtual: "agent", path: "Агент", content: "" });
      selectTab(key);
    },
    () => true,
  );
  function editorKeydown(event: KeyboardEvent) {
    if (
      active()?.virtual === "project" &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      event.stopPropagation();
      void ctx.saveProjectSettings?.();
      return;
    }
    if (
      !(event.target as Element).closest(
        ".keybindings-editor, .project-settings-form, .terminal-view",
      )
    )
      editorCommands.keydown(event);
  }
  function editorFocus(event: FocusEvent) {
    if (!(event.target as Element)?.closest(".workspace-tabs, .keybindings-editor, .terminal-view"))
      editorCommands.scope.activate();
  }
  return { tabActions, editorKeydown, editorFocus };
}
