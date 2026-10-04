import { defineTab, singletonTab } from "../../workspace-api/index.ts";

/** Kinds every workspace has; profiles add their own through `profile.tabs`. */
export const baseTabTypes = [
  singletonTab("settings", "settings:app", "Настройки", "Настройки Projector", {
    subtitle: "настройки Projector",
    command: {
      id: "ide.workbench.settings.open",
      title: "Открыть настройки Projector",
      description:
        "Открывает общие настройки Projector во вкладке текущего воркспейса. Повторный вызов фокусирует существующую вкладку; формы сохраняют черновики до её закрытия.",
    },
  }),
  singletonTab(
    "keybindings",
    "settings:keybindings",
    "Горячие клавиши",
    "Настройки горячих клавиш",
    {
      subtitle: "настройки IDE",
      command: { id: "ide.workbench.keybindings.open", title: "Открыть горячие клавиши" },
    },
  ),
  singletonTab("network", "network:info", "Локальная сеть", "Доступ по локальной сети", {
    subtitle: "доступ по сети",
    command: {
      id: "ide.workbench.server.network.open",
      title: "Показать доступ по локальной сети",
    },
  }),
  defineTab<{ hash: string; subject?: string }>({
    id: "commit",
    key: ({ hash }) => `commit:${hash}`,
    path: ({ hash }) => `Коммит ${hash.slice(0, 7)}`,
    title: ({ hash }, content) => `${content ? `${content} · ` : ""}${hash}`,
    hint: ({ subject }) => subject ?? "",
    read: ({ hash }, content) => ({ text: content, note: `Обзор коммита ${hash}` }),
  }),
];
