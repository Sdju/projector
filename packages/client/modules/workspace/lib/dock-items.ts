import {
  computed,
  inject,
  shallowRef,
  type Component,
  type InjectionKey,
  type ShallowRef,
} from "vue";
import type { IconName } from "../../../common/icons/registry.ts";
import { useAgentModes } from "../../agent/index.ts";
import { usageBarItems } from "../../agents-integration/status-bar/index.ts";
import {
  dockActionOf,
  dockActions,
  dockItemId,
  useDockLayout,
  type DockAction,
  type DockAlign,
  type DockEdge,
} from "./dock-layout.ts";

export const DOCK_CELL_PREFIX: InjectionKey<string> = Symbol("dock-cell-prefix");
export const DOCK_CELLS: InjectionKey<ShallowRef<ReadonlyMap<string, HTMLElement>>> =
  Symbol("dock-cells");
export const dockCellId = (prefix: string, item: string) =>
  `${prefix}-${item.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export type DockItemRegistration = Omit<DockItem, "edge" | "align"> & {
  edge?: DockEdge;
  align?: DockAlign;
};

const registered = shallowRef<ReadonlyMap<string, DockItemRegistration>>(new Map());

/** Регистрирует самостоятельный виджет; возвращает функцию отмены регистрации. */
export function registerDockItem(item: DockItemRegistration): () => void {
  registered.value = new Map(registered.value).set(item.id, item);
  return () => {
    if (registered.value.get(item.id) !== item) return;
    const next = new Map(registered.value);
    next.delete(item.id);
    registered.value = next;
  };
}

export interface DockActionDelegate {
  component: Component;
  props?: () => Record<string, unknown>;
}

export const DOCK_ACTION_DELEGATES: InjectionKey<
  ShallowRef<ReadonlyMap<string, DockActionDelegate>>
> = Symbol("dock-action-delegates");
const delegatedActions = new Set(["session", "project-run", "project-repository", "layout"]);

export function registerDockActionDelegate(action: string, delegate: DockActionDelegate) {
  const delegates = inject(DOCK_ACTION_DELEGATES);
  if (!delegates) return () => undefined;
  delegates.value = new Map(delegates.value).set(action, delegate);
  return () => {
    if (delegates.value.get(action) !== delegate) return;
    const next = new Map(delegates.value);
    next.delete(action);
    delegates.value = next;
  };
}

/** Один переносимый элемент интерфейса: индикатор лимита, баланс или кнопка шапки. */
export interface DockItem {
  id: string;
  title: string;
  icon: IconName;
  edge: DockEdge;
  align: DockAlign;
  component?: Component;
  props?: Record<string, unknown>;
  action?: DockAction;
}

/**
 * Каталог элементов для двух панелей. Индикаторы по умолчанию живут внизу (это их прежнее
 * место), кнопки — в шапке. Явно выбранная панель важнее умолчания.
 */
export function useDockCatalog() {
  const { isEnabled } = useAgentModes();
  const layout = useDockLayout();
  const delegates = inject(DOCK_ACTION_DELEGATES, shallowRef(new Map()));

  const usage = computed<DockItem[]>(() =>
    usageBarItems(isEnabled).map((item) => ({
      id: item.id,
      title: item.title,
      icon: item.icon,
      edge: layout.edgeOf(item.id, "bottom"),
      align: layout.alignOf(item.id),
      component: item.component,
      props: item.props,
    })),
  );
  const actions = computed<DockItem[]>(() =>
    dockActions.map((action) => {
      const id = dockItemId(action.id);
      return {
        id,
        title: action.title,
        icon: action.icon,
        edge: layout.edgeOf(id, "top"),
        align: layout.alignOf(id),
        action,
      };
    }),
  );
  const custom = computed<DockItem[]>(() =>
    [...registered.value.values()].map((item) => ({
      ...item,
      edge: layout.edgeOf(item.id, item.edge ?? "bottom"),
      align: layout.alignOf(item.id, item.align),
    })),
  );
  const all = computed<DockItem[]>(() => [...usage.value, ...actions.value, ...custom.value]);

  function available(inbox = true, includeUnavailable = false): DockItem[] {
    return all.value.filter(
      (item) =>
        (item.action?.id !== "inbox" || inbox) &&
        (includeUnavailable ||
          !item.action ||
          !delegatedActions.has(item.action.id) ||
          delegates.value.has(item.action.id)),
    );
  }

  function itemsFor(
    edge: DockEdge,
    options: {
      align?: DockAlign;
      inbox?: boolean;
      includeHidden?: boolean;
      includeUnavailable?: boolean;
    } = {},
  ): DockItem[] {
    const items = available(options.inbox ?? true, options.includeUnavailable)
      .filter((item) => item.edge === edge)
      .filter((item) => !options.align || item.align === options.align)
      .filter((item) => options.includeHidden || !layout.isHidden(item.id));
    return layout.sort(items, (item) => item.id);
  }

  function idsFor(
    edge: DockEdge,
    options: {
      align?: DockAlign;
      inbox?: boolean;
      includeHidden?: boolean;
      includeUnavailable?: boolean;
    } = {},
  ): string[] {
    return itemsFor(edge, options).map((item) => item.id);
  }

  function allIds(options: { inbox?: boolean } = {}): string[] {
    return available(options.inbox ?? true, true).map((item) => item.id);
  }

  function edgeOfItem(item: string): DockEdge {
    const found = all.value.find((value) => value.id === item);
    return found?.edge ?? (dockActionOf(item) ? "top" : "bottom");
  }

  function alignOfItem(item: string): DockAlign {
    return all.value.find((value) => value.id === item)?.align ?? "end";
  }

  function hasItem(item: string): boolean {
    return all.value.some((value) => value.id === item);
  }

  return {
    layout,
    usage,
    actions,
    all,
    available,
    itemsFor,
    idsFor,
    allIds,
    edgeOfItem,
    alignOfItem,
    hasItem,
  };
}
