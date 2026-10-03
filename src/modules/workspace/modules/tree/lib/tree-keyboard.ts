import { selectTreeRange, type createTreeSelection } from "./tree-selection.ts";
import { parentPath } from "../../../../../../core/modules/workspace/index.ts";
import type { FileEntry } from "../../../../../../core/modules/workspace/index.ts";
import type { Ref } from "vue";
import type { useTreeOperations } from "./tree-operations.ts";

interface KeyboardContext {
  tree: Ref<HTMLElement | undefined>;
  selection: ReturnType<typeof createTreeSelection>;
  expanded: Ref<Set<string>>;
  busy: Ref<boolean>;
  contextEntry: Ref<FileEntry | undefined>;
  treeCommands: ReturnType<typeof useTreeOperations>["treeCommands"];
  toggle: (path: string) => void;
}

/** Выбор строк и навигация по дереву с клавиатуры. */
export function useTreeKeyboard({
  tree,
  selection,
  expanded,
  busy,
  contextEntry,
  treeCommands,
  toggle,
}: KeyboardContext) {
  function visibleRows() {
    return [...(tree.value?.querySelectorAll<HTMLButtonElement>("button[data-path]") ?? [])];
  }
  function selectEntry(event: MouseEvent | KeyboardEvent, entry: FileEntry) {
    const result = selectTreeRange(
      selection.paths.value,
      selection.anchor.value,
      entry.path,
      visibleRows().map((row) => row.dataset.path!),
      event,
    );
    selection.paths.value = result.paths;
    selection.anchor.value = result.anchor;
  }
  function entryKey(event: KeyboardEvent, entry?: FileEntry) {
    contextEntry.value = entry;
    treeCommands.scope.activate();
    if (busy.value) {
      event.preventDefault();
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      const rows = visibleRows();
      selection.paths.value = new Set(rows.map((row) => row.dataset.path!));
      if (!selection.anchor.value)
        selection.anchor.value = entry?.path ?? rows[0]?.dataset.path ?? "";
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      selection.replace();
      return;
    }
    if (
      entry &&
      ["ArrowUp", "ArrowDown", "Home", "End", "ArrowLeft", "ArrowRight", " "].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === " ") {
        selectEntry(event, entry);
        return;
      }
      const rows = visibleRows();
      const index = rows.findIndex((row) => row.dataset.path === entry.path);
      let next = index;
      if (event.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1);
      if (event.key === "ArrowUp") next = Math.max(0, index - 1);
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = rows.length - 1;
      if (event.key === "ArrowRight") {
        if (!entry.directory) return;
        if (!expanded.value.has(entry.path)) {
          toggle(entry.path);
          return;
        }
        if (rows[index + 1]?.dataset.path?.startsWith(entry.path + "/")) next = index + 1;
      }
      if (event.key === "ArrowLeft") {
        if (entry.directory && expanded.value.has(entry.path)) {
          toggle(entry.path);
          return;
        }
        next = rows.findIndex((row) => row.dataset.path === parentPath(entry.path));
      }
      const row = rows[next];
      if (row) {
        if (!mod || event.shiftKey)
          selectEntry(event, {
            path: row.dataset.path!,
            name: "",
            directory: row.getAttribute("aria-expanded") !== null,
          });
        row.focus();
        row.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    treeCommands.keydown(event);
  }
  return { visibleRows, selectEntry, entryKey };
}
