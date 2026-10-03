import type { DockLayout, DockTarget } from "./types.ts";
import {
  rootEdgeShare,
  copy,
  isEdge,
  findDockGroup,
  groupOfPanel,
  dockGroups,
  dockPanels,
  locate,
  idFactory,
  normalizeSizes,
  finish,
  commit,
  detach,
  insertBeside,
  newGroup,
  placeInto,
} from "./tree.ts";

export function activatePanel(layout: DockLayout, panel: string): DockLayout {
  const next = copy(layout);
  const group = groupOfPanel(next, panel);
  if (!group) return layout;
  group.active = panel;
  delete group.hidden;
  next.focused = group.id;
  if (next.maximized && next.maximized !== group.id) delete next.maximized;
  return commit(layout, finish(next));
}

export function focusGroup(layout: DockLayout, groupId: string): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (!group || group.hidden) return layout;
  next.focused = groupId;
  return commit(layout, next);
}

export function addPanel(
  layout: DockLayout,
  panel: string,
  target: DockTarget = {},
  activate = true,
): DockLayout {
  if (groupOfPanel(layout, panel)) return activate ? activatePanel(layout, panel) : layout;
  const next = copy(layout);
  const group = placeInto(next, panel, target, activate);
  return commit(layout, finish(next, activate ? group.id : undefined));
}

export function removePanel(layout: DockLayout, panel: string): DockLayout {
  const next = copy(layout);
  if (!detach(next, panel)) return layout;
  return commit(layout, finish(next));
}

export function movePanel(layout: DockLayout, panel: string, target: DockTarget): DockLayout {
  const source = groupOfPanel(layout, panel);
  const destination = target.groupId ? findDockGroup(layout, target.groupId) : undefined;
  if (!source) return layout;
  if (!destination && !isEdge(target.zone)) return layout;
  // Разделять группу единственной вкладкой бессмысленно: она просто останется на месте.
  if (isEdge(target.zone) && destination === source && source.panels.length === 1) return layout;
  const next = copy(layout);
  const from = groupOfPanel(next, panel)!;
  const to = destination ? findDockGroup(next, destination.id) : undefined;
  if (isEdge(target.zone)) {
    const ids = idFactory(next);
    detach(next, panel);
    const group = newGroup(ids("g"), panel, from);
    const anchor = to ?? next.root;
    insertBeside(next, anchor, group, target.zone, ids, anchor === next.root ? rootEdgeShare : 0.5);
    return commit(layout, finish(next, group.id));
  }
  if (from === to) {
    const original = from.panels.indexOf(panel);
    const wanted = target.index ?? from.panels.length;
    from.panels.splice(original, 1);
    from.panels.splice(
      Math.max(0, Math.min(wanted > original ? wanted - 1 : wanted, from.panels.length)),
      0,
      panel,
    );
    from.active = panel;
    return commit(layout, finish(next, from.id));
  }
  detach(next, panel);
  const group = placeInto(
    next,
    panel,
    { groupId: to!.id, zone: "center", index: target.index },
    true,
  );
  return commit(layout, finish(next, group.id));
}

export function reorderPanels(layout: DockLayout, groupId: string, order: string[]): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (
    !group ||
    order.length !== group.panels.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !group.panels.includes(id))
  )
    return layout;
  group.panels = order;
  return commit(layout, next);
}

export function replacePanel(layout: DockLayout, from: string, to: string): DockLayout {
  const next = copy(layout);
  const group = groupOfPanel(next, from);
  if (!group || groupOfPanel(next, to)) return layout;
  group.panels[group.panels.indexOf(from)] = to;
  if (group.active === from) group.active = to;
  return commit(layout, next);
}

export function setGroupHidden(layout: DockLayout, groupId: string, hidden: boolean): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (!group) return layout;
  group.hidden = hidden || undefined;
  return commit(layout, finish(next, hidden ? undefined : groupId));
}

export function toggleMaximized(layout: DockLayout, groupId: string): DockLayout {
  const next = copy(layout);
  const group = findDockGroup(next, groupId);
  if (!group || group.hidden) return layout;
  if (next.maximized === groupId) delete next.maximized;
  else next.maximized = groupId;
  next.focused = groupId;
  return commit(layout, next);
}

export function setSplitSizes(layout: DockLayout, splitId: string, sizes: number[]): DockLayout {
  const next = copy(layout);
  const found = locate(next.root, splitId);
  if (found?.node.type !== "split" || sizes.length !== found.node.children.length) return layout;
  found.node.sizes = normalizeSizes(sizes);
  return commit(layout, next);
}

/**
 * Приводит раскладку в соответствие с реальным набором панелей: убирает исчезнувшие и добавляет новые.
 * `exists` возвращает undefined, пока источник панелей не загружен: такие панели не трогаются.
 */
export function reconcileDock(
  layout: DockLayout,
  options: {
    ids: string[];
    exists: (panel: string) => boolean | undefined;
    place?: (panel: string, layout: DockLayout) => DockTarget | undefined;
    /** Восстанавливает назначение групп из старых сохранённых раскладок. */
    role?: (panel: string) => string;
  },
): DockLayout {
  const next = copy(layout);
  for (const group of dockGroups(next))
    if (!group.role && group.panels.length && options.role)
      group.role = options.role(group.active || group.panels[0]!);
  for (const panel of dockPanels(next)) if (options.exists(panel) === false) detach(next, panel);
  for (const panel of options.ids)
    if (!groupOfPanel(next, panel))
      placeInto(next, panel, options.place?.(panel, next) ?? {}, false);
  return commit(layout, finish(next));
}
