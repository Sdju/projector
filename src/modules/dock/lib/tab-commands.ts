import type { Ref } from "vue";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";

export interface DockTab {
  id: string;
  label: string;
  title?: string;
  dirty?: boolean;
  saving?: boolean;
  error?: boolean;
  /** Вкладку можно переименовать независимо от общего флага `renameable`. */
  renameable?: boolean;
  /** Вкладка предварительного просмотра: отображается курсивом и закрепляется двойным щелчком. */
  preview?: boolean;
}
export interface TabCommandProps {
  tabs: DockTab[];
  activeId: string;
  renameable?: boolean;
  disabled?: boolean;
  closeSaved?: boolean;
  commandNamespace: string;
  commandHandlers: {
    select: (id: string) => unknown;
    close: (id: string) => unknown;
    closeMany: (ids: string[]) => unknown;
    reorder: (ids: string[]) => unknown;
    rename?: (id: string, label: string) => unknown;
    pin?: (id: string) => unknown;
  };
}
interface TabCommandContext {
  props: TabCommandProps;
  commands: ReturnType<typeof useCommandScope>;
  /** Вкладка, для которой открыто контекстное меню. */
  contextId: Ref<string>;
  strip: Ref<HTMLElement | undefined>;
  menu: Ref<{ openForElement(element: HTMLElement): unknown } | undefined>;
  startRename: (tab: DockTab) => unknown;
}

export const tabCommandId = (namespace: string, action: string) => `${namespace}.${action}`;

/** Регистрирует команды полосы вкладок: выбор, закрытие, переименование, перестановка и переходы. */
export function registerTabCommands({
  props,
  commands,
  contextId,
  strip,
  menu,
  startRename,
}: TabCommandContext) {
  const commandId = (action: string) => tabCommandId(props.commandNamespace, action);
  function findTab(value?: unknown) {
    const args = commandArgs(value);
    if (args.id !== undefined && typeof args.id !== "string")
      throw new Error("id должен быть строкой");
    return props.tabs.find((tab) => tab.id === (args.id ?? (contextId.value || props.activeId)));
  }
  const register = (
    action: string,
    title: string,
    run: (args?: unknown) => unknown,
    enabled: (args?: unknown) => boolean = () => true,
  ) =>
    commands.scope.registerCommand({
      id: commandId(action),
      palette: action !== "reorder",
      title,
      run,
      enabled: (args) => !props.disabled && enabled(args),
    });
  const hasTab = (args?: unknown) => !!findTab(args);
  register(
    "select",
    "Открыть вкладку",
    (args) => props.commandHandlers.select(findTab(args)!.id),
    hasTab,
  );
  register("close", "Закрыть", (args) => props.commandHandlers.close(findTab(args)!.id), hasTab);
  register(
    "closeOthers",
    "Закрыть остальные",
    (args) =>
      props.commandHandlers.closeMany(
        props.tabs.filter((tab) => tab.id !== findTab(args)!.id).map((tab) => tab.id),
      ),
    (args) => hasTab(args) && props.tabs.length > 1,
  );
  register(
    "closeLeft",
    "Закрыть слева",
    (args) =>
      props.commandHandlers.closeMany(
        props.tabs.slice(0, props.tabs.indexOf(findTab(args)!)).map((tab) => tab.id),
      ),
    (args) => hasTab(args) && props.tabs.indexOf(findTab(args)!) > 0,
  );
  register(
    "closeRight",
    "Закрыть справа",
    (args) =>
      props.commandHandlers.closeMany(
        props.tabs.slice(props.tabs.indexOf(findTab(args)!) + 1).map((tab) => tab.id),
      ),
    (args) => hasTab(args) && props.tabs.indexOf(findTab(args)!) < props.tabs.length - 1,
  );
  register(
    "closeAll",
    "Закрыть все",
    () => props.commandHandlers.closeMany(props.tabs.map((tab) => tab.id)),
    () => !!props.tabs.length,
  );
  register(
    "closeSaved",
    "Закрыть сохранённые",
    () =>
      props.commandHandlers.closeMany(
        props.tabs.filter((tab) => !tab.dirty && !tab.saving).map((tab) => tab.id),
      ),
    () => !!props.closeSaved && props.tabs.some((tab) => !tab.dirty && !tab.saving),
  );
  register(
    "rename",
    "Переименовать…",
    (value) => {
      const args = commandArgs(value);
      const tab = findTab(value)!;
      if (args.label === undefined) return startRename(tab);
      if (typeof args.label !== "string" || !args.label.trim())
        throw new Error("Укажите label вкладки");
      return props.commandHandlers.rename?.(tab.id, args.label.trim());
    },
    (args) => hasTab(args) && !!(props.renameable || findTab(args)?.renameable),
  );
  register(
    "pin",
    "Закрепить вкладку",
    (args) => props.commandHandlers.pin?.(findTab(args)!.id),
    (args) => hasTab(args) && !!findTab(args)?.preview,
  );
  register("reorder", "Переставить вкладки", (value) => {
    const { ids } = commandArgs(value);
    if (
      !Array.isArray(ids) ||
      ids.length !== props.tabs.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || !props.tabs.some((tab) => tab.id === id))
    )
      throw new Error("Укажите все id вкладок без повторений");
    return props.commandHandlers.reorder(ids);
  });
  for (const action of ["next", "previous", "first", "last"])
    register(
      action,
      "Перейти к вкладке",
      (args) => {
        const index = props.tabs.indexOf(findTab(args)!);
        const next =
          action === "first"
            ? 0
            : action === "last"
              ? props.tabs.length - 1
              : (index + (action === "next" ? 1 : props.tabs.length - 1)) % props.tabs.length;
        const tab = props.tabs[next]!;
        const result = props.commandHandlers.select(tab.id);
        strip.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        return result;
      },
      hasTab,
    );
  register(
    "contextMenu",
    "Открыть меню вкладки",
    (args) => {
      const tab = findTab(args)!;
      contextId.value = tab.id;
      const index = props.tabs.indexOf(tab);
      const target = strip.value?.querySelectorAll<HTMLElement>('[role="tab"]')[index];
      if (target) return menu.value?.openForElement(target);
    },
    hasTab,
  );
  return { findTab };
}
