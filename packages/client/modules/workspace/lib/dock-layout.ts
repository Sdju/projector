import { computed, ref } from "vue";
import type { IconName } from "../../../common/icons/registry.ts";
import { useActionOrder } from "./action-order.ts";
import { useHiddenActions } from "./hidden-actions.ts";

/**
 * Две уже существующие панели — шапка (верх) и нижняя строка (низ) — один набор мест.
 * Край хранится отдельным списком, а общий порядок (`dock-order`) задаёт место элемента
 * внутри панели. Видимость лежит в общем списке скрытых действий.
 */
export const DOCK_EDGES = ["top", "bottom"] as const;
export type DockEdge = (typeof DOCK_EDGES)[number];
export const DOCK_ALIGNS = ["start", "end"] as const;
export type DockAlign = (typeof DOCK_ALIGNS)[number];
export const DOCK_MIME = "application/x-projector-dock-item";
const ORDER_SCOPE = "dock-order";
const EDGE_SCOPE: Record<DockEdge, string> = {
  top: "dock:top",
  bottom: "dock:bottom",
};
const PLACEMENT_SCOPE: Record<DockEdge, Record<DockAlign, string>> = {
  top: { start: "dock:top:start", end: "dock:top:end" },
  bottom: { start: "dock:bottom:start", end: "dock:bottom:end" },
};
/** Края из первой версии модели: боковых полос больше нет, элементы возвращаются вниз. */
const LEGACY_SIDE_SCOPES = ["dock:left", "dock:right"] as const;
const LEGACY_ORDER = "statusbar";
const LEGACY_WIDGETS = "statusbar-widgets";

export const dockEdgeTitles: Record<DockEdge, string> = {
  top: "Верх",
  bottom: "Низ",
};
export const dockAlignTitles: Record<DockAlign, string> = {
  start: "Слева",
  end: "Справа",
};

/** `header` и `bar` — прежние имена сторон; `left`/`right` из первой версии сводятся к низу. */
export function parseDockEdge(value: unknown): DockEdge | undefined {
  if (typeof value !== "string") return;
  if ((DOCK_EDGES as readonly string[]).includes(value)) return value as DockEdge;
  if (value === "header") return "top";
  if (value === "bar" || value === "statusbar" || value === "left" || value === "right")
    return "bottom";
}
export function parseDockAlign(value: unknown): DockAlign | undefined {
  if (value === "start" || value === "left") return "start";
  if (value === "end" || value === "right") return "end";
}

/** Кнопка шапки, которую можно перенести в нижнюю строку. */
export interface DockAction {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  command: string;
}

export const dockActions: readonly DockAction[] = [
  {
    id: "session",
    title: "Новая сессия",
    description: "Запуск shell или кодового агента",
    icon: "plus",
    command: "",
  },
  {
    id: "project-run",
    title: "Запуск проекта",
    description: "Команды запуска проекта",
    icon: "play",
    command: "",
  },
  {
    id: "project-repository",
    title: "Репозиторий проекта",
    description: "Действия репозитория проекта",
    icon: "git-branch",
    command: "",
  },
  {
    id: "inbox",
    title: "Входящие",
    description: "Задания и запросы агентов",
    icon: "bell",
    command: "ide.workbench.inbox.open",
  },
  {
    id: "analytics",
    title: "Аналитика расхода",
    description: "Расход, лимиты и балансы",
    icon: "chart-no-axes-column",
    command: "ide.workbench.analytics.open",
  },
  {
    id: "media",
    title: "Генерация медиа",
    description: "Картинки, видео и звук",
    icon: "sparkles",
    command: "ide.media.open",
  },
  {
    id: "settings",
    title: "Настройки Projector",
    description: "Интерфейс, агенты и интеграции",
    icon: "settings-2",
    command: "ide.workbench.settings.open",
  },
  {
    id: "layout",
    title: "Раскладка",
    description: "Панели и раскладки рабочей области",
    icon: "layout-panel-left",
    command: "",
  },
];

export const dockItemId = (action: string): string => `action:${action}`;
export const dockActionOf = (item: string): string | undefined =>
  item.startsWith("action:") ? item.slice("action:".length) : undefined;
export function isDockActionName(id: string): boolean {
  return dockActions.some((action) => action.id === id);
}

/** Элемент, который сейчас перетаскивают; общий для шапки и нижней строки. */
export const dockDragging = ref<string>();

export function endDockDrag(): void {
  dockDragging.value = undefined;
}

export function useDockLayout() {
  const visibility = useHiddenActions();
  const order = useActionOrder(ORDER_SCOPE);
  const legacyOrder = useActionOrder(LEGACY_ORDER);
  const legacyWidgets = useActionOrder(LEGACY_WIDGETS);
  const edges = Object.fromEntries(
    DOCK_EDGES.map((edge) => [edge, useActionOrder(EDGE_SCOPE[edge])]),
  ) as Record<DockEdge, ReturnType<typeof useActionOrder>>;
  const placements = Object.fromEntries(
    DOCK_EDGES.flatMap((edge) =>
      DOCK_ALIGNS.map((align) => [
        `${edge}:${align}`,
        useActionOrder(PLACEMENT_SCOPE[edge][align]),
      ]),
    ),
  ) as Record<`${DockEdge}:${DockAlign}`, ReturnType<typeof useActionOrder>>;
  const sideScopes = LEGACY_SIDE_SCOPES.map((scope) => useActionOrder(scope));

  const isHidden = (item: string): boolean => {
    const action = dockActionOf(item);
    return (
      visibility.hidden.value.includes(`dock:${item}`) ||
      visibility.hidden.value.includes(`statusbar:${item}`) ||
      (!!action && visibility.hidden.value.includes(`toolbar:${action}`))
    );
  };

  function explicitEdge(item: string): DockEdge | undefined {
    for (const edge of DOCK_EDGES) {
      if (DOCK_ALIGNS.some((align) => placements[`${edge}:${align}`].order.value.includes(item)))
        return edge;
      if (edges[edge].order.value.includes(item)) return edge;
    }
    if (sideScopes.some((scope) => scope.order.value.includes(item))) return "bottom";
    const action = dockActionOf(item);
    if (action && legacyWidgets.order.value.includes(action)) return "bottom";
    // A saved reorder of the old bottom bar is a bottom placement for its buttons too.
    if (action && legacyOrder.order.value.includes(item)) return "bottom";
    return undefined;
  }

  function edgeOf(item: string, fallback: DockEdge): DockEdge {
    return explicitEdge(item) ?? fallback;
  }
  function alignOf(item: string, fallback: DockAlign = "end"): DockAlign {
    for (const align of DOCK_ALIGNS) {
      if (DOCK_EDGES.some((edge) => placements[`${edge}:${align}`].order.value.includes(item)))
        return align;
    }
    return fallback;
  }

  /** Порядок до первого перетаскивания берётся из прежней нижней строки, затем из каталога. */
  function orderList(): string[] {
    return order.order.value.length ? order.order.value : legacyOrder.order.value;
  }

  function sort<T>(items: T[], id: (item: T) => string): T[] {
    const list = orderList();
    if (!list.length) return items;
    const index = new Map(list.map((value, position) => [value, position]));
    return [...items].sort(
      (a, b) =>
        (index.get(id(a)) ?? Number.POSITIVE_INFINITY) -
        (index.get(id(b)) ?? Number.POSITIVE_INFINITY),
    );
  }

  async function setHidden(item: string, hidden: boolean): Promise<void> {
    if (hidden) {
      if (!isHidden(item)) await visibility.setHidden(`dock:${item}`, true);
      return;
    }
    if (visibility.hidden.value.includes(`dock:${item}`))
      await visibility.setHidden(`dock:${item}`, false);
    if (visibility.hidden.value.includes(`statusbar:${item}`))
      await visibility.setHidden(`statusbar:${item}`, false);
    const action = dockActionOf(item);
    if (action && visibility.hidden.value.includes(`toolbar:${action}`))
      await visibility.setHidden(`toolbar:${action}`, false);
  }

  async function clearActionHidden(action: string): Promise<void> {
    if (visibility.hidden.value.includes(`toolbar:${action}`))
      await visibility.setHidden(`toolbar:${action}`, false);
  }

  async function place(item: string, edge: DockEdge, align = alignOf(item)): Promise<void> {
    await setHidden(item, false);
    const action = dockActionOf(item);
    if (action) await clearActionHidden(action);
    for (const other of DOCK_EDGES) {
      for (const otherAlign of DOCK_ALIGNS) {
        const scope = placements[`${other}:${otherAlign}`];
        if ((other !== edge || otherAlign !== align) && scope.order.value.includes(item))
          await scope.update((ids) => ids.filter((id) => id !== item));
      }
      if (other !== edge && edges[other].order.value.includes(item))
        await edges[other].update((ids) => ids.filter((id) => id !== item));
    }
    for (const scope of sideScopes)
      if (scope.order.value.includes(item))
        await scope.update((ids) => ids.filter((id) => id !== item));
    if (!edges[edge].order.value.includes(item))
      await edges[edge].update((ids) => (ids.includes(item) ? undefined : [...ids, item]));
    const placement = placements[`${edge}:${align}`];
    if (!placement.order.value.includes(item))
      await placement.update((ids) => (ids.includes(item) ? undefined : [...ids, item]));
  }

  /** `visible` — элементы одной панели, `all` — весь каталог: общий порядок не теряет чужую панель. */
  async function move(
    visible: string[],
    all: string[],
    from: string,
    to: string,
    after: boolean,
  ): Promise<void> {
    await order.move(visible, from, to, after, all);
  }

  return {
    hidden: visibility.hidden,
    error: computed(() => visibility.error.value),
    isHidden,
    edgeOf,
    alignOf,
    sort,
    place,
    setHidden,
    clearActionHidden,
    move,
  };
}
