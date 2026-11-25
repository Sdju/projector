import { computed, provide, shallowRef, useId } from "vue";
import type { WorkspaceCapability } from "../../workspace-api/index.ts";
import {
  DOCK_ACTION_DELEGATES,
  DOCK_CELL_PREFIX,
  DOCK_CELLS,
  useDockCatalog,
  type DockActionDelegate,
} from "./dock-items.ts";
import {
  dockActionOf,
  parseDockAlign,
  parseDockEdge,
  type DockAlign,
  type DockEdge,
} from "./dock-layout.ts";

type DockCommandRegistrar = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: WorkspaceCapability,
  meta?: { description?: string; arguments?: Record<string, string> },
) => unknown;

/**
 * Состояние и команды верхней и нижней панелей. Каталог и раскладку не знает никто, кроме
 * этого модуля: шапка и нижняя строка получают один и тот же набор команд.
 */
export function useDockWorkspace(register: DockCommandRegistrar, inbox: () => boolean) {
  provide(DOCK_CELL_PREFIX, `dock-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`);
  provide(DOCK_CELLS, shallowRef(new Map<string, HTMLElement>()));
  provide(DOCK_ACTION_DELEGATES, shallowRef(new Map<string, DockActionDelegate>()));
  const catalog = useDockCatalog();
  const dockInbox = computed(inbox);

  function itemArg(value: unknown): string {
    if (typeof value !== "string" || !catalog.hasItem(value))
      throw new Error("Неизвестный элемент панели");
    return value;
  }
  function edgeArg(value: unknown): DockEdge {
    const edge = parseDockEdge(value);
    if (!edge) throw new Error("Укажите edge: top или bottom");
    return edge;
  }
  async function place(item: string, edge: DockEdge, align: DockAlign = catalog.alignOfItem(item)) {
    // Сброс на фон выбранной панели переносит элемент в конец, а не оставляет на месте.
    if (
      catalog.edgeOfItem(item) === edge &&
      catalog.alignOfItem(item) === align &&
      !catalog.layout.isHidden(item)
    ) {
      const edgeItems = catalog.idsFor(edge, {
        align,
        inbox: dockInbox.value,
        includeUnavailable: true,
      });
      const last = edgeItems.filter((id) => id !== item).at(-1);
      if (last) {
        await catalog.layout.move(
          edgeItems,
          catalog.allIds({ inbox: dockInbox.value }),
          item,
          last,
          true,
        );
        return;
      }
    }
    await catalog.layout.place(item, edge, align);
  }

  register(
    "ide.workbench.dock.item.place",
    "Переместить элемент в другую панель",
    async (args) => {
      const value = args as { item?: unknown; edge?: unknown; align?: unknown };
      const align = value.align === undefined ? undefined : parseDockAlign(value.align);
      if (value.align !== undefined && !align) throw new Error("Укажите align: start или end");
      await place(itemArg(value?.item), edgeArg(value?.edge), align);
    },
    () => true,
    undefined,
    {
      description:
        "Переносит индикатор или кнопку в шапку или нижнюю строку и выбирает выравнивание. Сброс на фон той же группы ставит элемент в конец.",
      arguments: {
        item: "string: идентификатор элемента (`usage:<backend>`, `balance` или `action:<id>`)",
        edge: "string: top или bottom",
        align: "string: start (слева) или end (справа); по умолчанию текущее выравнивание",
      },
    },
  );
  register(
    "ide.workbench.dock.item.move",
    "Переместить элемент внутри панели",
    async (args) => {
      const value = args as {
        edge?: unknown;
        align?: unknown;
        from?: unknown;
        to?: unknown;
        after?: unknown;
      };
      if (typeof value?.after !== "boolean") throw new Error("Укажите after");
      const from = itemArg(value.from);
      const to = itemArg(value.to);
      const edge = parseDockEdge(value.edge) ?? catalog.edgeOfItem(from);
      const align = parseDockAlign(value.align) ?? catalog.alignOfItem(from);
      await catalog.layout.move(
        catalog.idsFor(edge, { align, inbox: dockInbox.value, includeUnavailable: true }),
        catalog.allIds({ inbox: dockInbox.value }),
        from,
        to,
        value.after,
      );
    },
    () => true,
    undefined,
    {
      description: "Меняет порядок индикаторов и кнопок на одной панели, сохраняя общий порядок.",
      arguments: {
        edge: "string: top или bottom; по умолчанию панель элемента",
        from: "string: перемещаемый элемент",
        to: "string: соседний элемент",
        after: "boolean: разместить после",
      },
    },
  );
  register(
    "ide.workbench.dock.item.visibility.set",
    "Изменить видимость элемента панели",
    async (args) => {
      const value = args as { item?: unknown; visible?: unknown };
      const item = itemArg(value?.item);
      if (typeof value.visible !== "boolean") throw new Error("Укажите visible");
      await catalog.layout.setHidden(item, !value.visible);
      const action = dockActionOf(item);
      if (value.visible && action) await catalog.layout.clearActionHidden(action);
    },
    () => true,
    undefined,
    {
      description:
        "Скрывает элемент или возвращает его на выбранную панель. Скрытый индикатор остаётся смонтированным.",
      arguments: {
        item: "string: идентификатор элемента",
        visible: "boolean: показывать элемент",
      },
    },
  );

  return { dockInbox };
}
