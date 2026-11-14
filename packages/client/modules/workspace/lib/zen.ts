import { computed, onBeforeUnmount } from "vue";
import { useEventListener } from "@vueuse/core";
import { commandArgs, type useCommandScope } from "../../../common/utilities/commands.ts";
import {
  setZenAvailable,
  setZenMode,
  toggleZenMode,
  zenMode,
} from "../../../common/utilities/zen-mode.ts";

/** Регистрирует команду Zen-режима в рабочем пространстве и выход по Escape. */
export function useWorkspaceZen(editorCommands: ReturnType<typeof useCommandScope>) {
  setZenAvailable(true);
  editorCommands.scope.registerCommand({
    id: "ide.workbench.zen.toggle",
    title: "Режим Zen",
    description:
      "Разворачивает активный блок на всё окно и скрывает боковые панели, шапку, строку состояния и служебные элементы чата (панель отправки, футеры, детали работы и фоновую активность). Выход — повторный вызов, Esc или кнопка в углу.",
    arguments: {
      on: "boolean (необязательно): true — включить, false — выключить; без аргумента переключает",
    },
    enabled: () => true,
    run: (value) => {
      const { on } = commandArgs(value);
      if (on !== undefined && typeof on !== "boolean") throw new Error("on должен быть boolean");
      return { zen: toggleZenMode(on) };
    },
  });

  useEventListener(window, "keydown", (event) => {
    if (!zenMode.value || event.key !== "Escape" || event.defaultPrevented) return;
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (
      document.querySelector(
        "dialog[open], [popover]:popover-open, .island:not(.passive), .svg-viewer.fullscreen",
      )
    )
      return;
    const target = event.target;
    if (target instanceof Element && target.closest(".terminal-view, [data-own-keys]")) return;
    event.preventDefault();
    setZenMode(false);
  });

  onBeforeUnmount(() => setZenAvailable(false));

  const shortcut = computed(() => editorCommands.item("ide.workbench.zen.toggle").shortcut);
  return { zenMode, shortcut };
}
