import type { Ref } from "vue";
import type { FileEntry, FileScope } from "@ai-projector/core/modules/workspace/index.ts";
import type { createTreeDrag } from "./tree-drag.ts";
import type { createTreeSelection } from "./tree-selection.ts";
import type { createTreePaging } from "./tree-listing.ts";

/** What the tree calls on its context menu and entry dialog (their `defineExpose`). */
export interface TreeMenuHandle {
  openForElement(element: HTMLElement): unknown;
}
export interface TreeDialogHandle {
  open(options: {
    title: string;
    value?: string;
    description?: string;
    confirm?: boolean;
  }): unknown;
  close(): void;
  fail(message: string): void;
}
export interface TreeEmit {
  (event: "open", path: string, pinned?: boolean): void;
  (event: "moved", source: string, destination: string): void;
  (event: "changed"): void;
  (event: "deleted", path: string): void;
  (event: "info", entry: FileEntry): void;
}
export interface TreeContext {
  props: {
    projectId: string;
    path: string;
    scope: FileScope;
    beforeChange?: (path: string) => Promise<boolean>;
  };
  emit: TreeEmit;
  selection: ReturnType<typeof createTreeSelection>;
  drag: ReturnType<typeof createTreeDrag>;
  tree: Ref<HTMLElement | undefined>;
  menu: Ref<TreeMenuHandle | undefined>;
  dialog: Ref<TreeDialogHandle | undefined>;
  toggle: (path: string) => void;
  paging: ReturnType<typeof createTreePaging>;
}
