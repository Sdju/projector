import type { ContextMenuItem } from "../../../../../common/ui/context-menu.ts";
import type { FileEntry } from "@projector/core/modules/workspace/index.ts";

export interface TreeMenuOptions {
  entry?: FileEntry;
  expanded: ReadonlySet<string>;
  item: (
    id: string,
    options?: { separator?: boolean; danger?: boolean; label?: string },
  ) => ContextMenuItem;
  allowed: (commandId: string) => boolean;
}

/** File-tree context menu; commands filter themselves through `allowed`. */
export function treeMenuItems({ entry, expanded, item, allowed }: TreeMenuOptions) {
  const items: ContextMenuItem[] = [];
  if (entry && !entry.directory) items.push(item("file.open"));
  if (!entry || entry.directory) items.push(item("file.create"), item("directory.create"));
  if (entry)
    items.push(
      item(`${entry.directory ? "directory" : "file"}.rename`, { separator: true }),
      item("entry.cut"),
      item("entry.copy"),
      item("entry.duplicate"),
    );
  items.push(
    item("entry.paste"),
    item("entry.copyRelativePath", { separator: true }),
    item("entry.copyPath"),
  );
  if (entry?.directory)
    items.push(
      item("directory.toggle", {
        label: expanded.has(entry.path) ? "Свернуть папку" : "Развернуть папку",
      }),
    );
  if (!entry) items.push(item("collapseAll"));
  items.push(item("refresh"));
  if (entry) items.push(item("entry.delete", { danger: true, separator: true }));
  return items.filter((candidate) => allowed(candidate.id));
}
