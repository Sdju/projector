import type { InjectionKey, Slots } from "vue";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import type { DockLayout, DockTarget } from "../model/layout.ts";

export interface DockTabInfo {
  id: string;
  label: string;
  title?: string;
  dirty?: boolean;
  saving?: boolean;
  error?: boolean;
  renameable?: boolean;
}

/** Всё, что вложенные узлы раскладки получают от `DockLayout`, не передавая это через props. */
export interface DockContext {
  layout: () => DockLayout;
  slots: Slots;
  projectId: string;
  commandNamespace: string;
  describe: (id: string) => DockTabInfo;
  tabActions?: (id: string) => ContextMenuItem[];
  acceptsDrop?: (data: DataTransfer | null) => boolean;
  update: (layout: DockLayout) => void;
  select: (id: string) => void;
  close: (id: string) => void;
  closeMany: (ids: string[]) => void;
  rename: (id: string, label: string) => void;
  drop: (event: DragEvent, target: DockTarget) => void;
}

export const dockKey: InjectionKey<DockContext> = Symbol("dock");
