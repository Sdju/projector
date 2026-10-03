import { moveWorkspaceEntry } from "../../workspace-api/index.ts";
import { treeDragType } from "../tree-drag.ts";
import { topLevelTreePaths } from "../tree-selection.ts";
import {
  moveDestination,
  parentPath,
  relocatedPath,
} from "../../../../core/modules/workspace/index.ts";
import type { FileEntry } from "../../../../core/modules/workspace/index.ts";
import type { TreeContext } from "./tree-operations.ts";

/** Перетаскивание записей дерева: выбор цели, подсветка и перенос. */
export function useTreeDragDrop({ props, emit, selection, drag }: TreeContext) {
  const { source, busy, expanded, error: moveError, message } = drag;
  function startDrag(event: DragEvent, entry: FileEntry) {
    if (busy.value || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    if (!selection.paths.value.has(entry.path)) selection.replace(entry.path);
    selection.dragged.value = topLevelTreePaths(selection.paths.value);
    source.value = entry.path;
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(
      treeDragType,
      JSON.stringify({
        projectId: props.projectId,
        path: entry.path,
        paths: selection.dragged.value,
      }),
    );
  }
  function destinationFor(entry?: FileEntry) {
    return entry ? (entry.directory ? entry.path : parentPath(entry.path)) : props.path;
  }
  function dragOver(event: DragEvent, entry?: FileEntry) {
    if (!source.value || busy.value || !event.dataTransfer?.types.includes(treeDragType)) return;
    event.preventDefault();
    const directory = destinationFor(entry);
    const valid = selection.dragged.value.every((path) => !!moveDestination(path, directory));
    event.dataTransfer.dropEffect = valid ? "move" : "none";
    drag.hover(valid ? directory : undefined, valid && !!entry?.directory);
  }
  function dragLeave(event: DragEvent) {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
      drag.hover();
  }
  async function drop(event: DragEvent, entry?: FileEntry) {
    if (!source.value || busy.value || !event.dataTransfer?.types.includes(treeDragType)) return;
    event.preventDefault();
    const directory = destinationFor(entry);
    const paths = [...selection.dragged.value];
    if (!paths.length || paths.some((path) => !moveDestination(path, directory))) {
      drag.clear();
      return;
    }
    const projectId = props.projectId;
    moveError.value = "";
    message.value = "";
    busy.value = true;
    drag.clear();
    try {
      if (props.beforeChange)
        for (const path of paths)
          if (!(await props.beforeChange(path)))
            throw new Error("Сначала сохраните изменения открытых файлов");
      for (const path of paths) {
        const result = await moveWorkspaceEntry(projectId, path, directory);
        if (projectId !== props.projectId) return;
        expanded.value = new Set(
          [...expanded.value].map((value) =>
            relocatedPath(value, result.source, result.destination),
          ),
        );
        selection.relocate(result.source, result.destination);
        if (directory) expanded.value.add(directory);
        emit("moved", result.source, result.destination);
      }
      message.value = `Перенесено записей: ${paths.length}`;
    } catch (err) {
      if (projectId === props.projectId)
        moveError.value = err instanceof Error ? err.message : "Не удалось перенести запись";
    } finally {
      busy.value = false;
    }
  }
  return { startDrag, dragOver, dragLeave, drop };
}
