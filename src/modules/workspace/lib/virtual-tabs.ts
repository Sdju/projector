import { singletonTab } from "../../workspace-api/index.ts";

/** Kinds every workspace has; profiles add their own through `profile.tabs`. */
export const baseTabTypes = [
  singletonTab(
    "keybindings",
    "settings:keybindings",
    "Горячие клавиши",
    "Настройки горячих клавиш",
  ),
  singletonTab("network", "network:info", "Локальная сеть", "Доступ по локальной сети"),
];
